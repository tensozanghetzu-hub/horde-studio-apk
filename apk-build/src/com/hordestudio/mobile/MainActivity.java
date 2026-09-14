package com.hordestudio.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipFile;

/**
 * Offline-first WebView host for Horde Studio Mobile.
 *
 * The whole UI (HTML/CSS/JS) ships inside the APK as assets and is served to the
 * WebView from http://localhost/ - a real HTTP origin, so localStorage, IndexedDB,
 * service workers and CORS all behave exactly like they do on the web version.
 * Only provider traffic (your chosen LLM endpoint and the AI Horde) leaves the phone.
 */
public class MainActivity extends Activity {

    private static final String TAG = "HordeStudio";
    private static final String APP_HOST = "localhost";
    private static final int REQ_FILE = 1001;
    private static final int REQ_PERM = 1002;
    private static final int REQ_UPDATE = 1003;

    /* ---- self-update ----
     * The UI is HTML/CSS/JS in assets, which are read-only. An update is a small
     * zip unpacked into private storage and served ahead of the bundled files,
     * so fixes arrive without a reinstall. The overlay is strictly additive:
     * any file it does not contain, and the whole thing if it misbehaves, falls
     * back to the copy that shipped in the APK. */
    private static final String OVERLAY = "web";
    private static final String OVERLAY_REV = "web/.rev";
    private static final String OVERLAY_APK = "web/.apk";
    private static final String OVERLAY_PENDING = "web/.pending";
    private static final long ROLLBACK_AFTER_MS = 60000L;

    /* the job waiting on the file picker, for Apply from a file */
    private int updateJob = 0;
    private NativeBridge bridge = null;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        dropStaleOverlay();
        rollbackIfBroken();

        web = new WebView(this);
        setContentView(web);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(false);
        ws.setSupportZoom(false);
        ws.setBuiltInZoomControls(false);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setUserAgentString(ws.getUserAgentString() + " HordeStudioMobile/1.0");
        try {
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        } catch (Throwable ignored) { }

        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    String type = "*/*";
                    String[] accept = params.getAcceptTypes();
                    if (accept != null && accept.length > 0 && accept[0] != null && !accept[0].trim().isEmpty()) {
                        type = accept[0].trim();
                    }
                    i.setType(type);
                    startActivityForResult(Intent.createChooser(i, "Choose file"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    cb.onReceiveValue(null);
                    return false;
                }
            }
        });

        bridge = new NativeBridge();
        web.addJavascriptInterface(bridge, "HSAndroid");

        if (Build.VERSION.SDK_INT < 29 &&
                checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
        }

        if (savedInstanceState == null) {
            web.loadUrl("http://" + APP_HOST + "/index.html");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onRestoreInstanceState(Bundle in) {
        super.onRestoreInstanceState(in);
        if (web != null) web.restoreState(in);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            } else if (resultCode == Activity.RESULT_OK && data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                results = new Uri[n];
                for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        } else if (requestCode == REQ_UPDATE) {
            Job picked = null;
            synchronized (jobs) { picked = jobs.get(updateJob); }
            updateJob = 0;
            final Job job = picked;
            if (job == null) return;
            if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
                jobFail(job, "No file chosen");
                return;
            }
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override public void run() {
                    File zip = new File(getCacheDir(), "hs-picked.zip");
                    zip.delete();
                    InputStream in = null;
                    OutputStream os = null;
                    try {
                        in = getContentResolver().openInputStream(uri);
                        if (in == null) { jobFail(job, "Could not read that file"); return; }
                        os = new FileOutputStream(zip);
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    } catch (Exception e) {
                        jobFail(job, "Could not read that file: " + e.getMessage());
                        return;
                    } finally {
                        try { if (in != null) in.close(); } catch (Exception ignored) { }
                        try { if (os != null) { os.flush(); os.close(); } } catch (Exception ignored) { }
                    }
                    job.progress = 40;
                    if (bridge == null) { jobFail(job, "Update is not ready yet"); return; }
                    String rev = bridge.revFromBundle(zip);
                    if (rev == null || rev.length() == 0) rev = String.valueOf(System.currentTimeMillis());
                    bridge.finishSwap(zip, rev, job);
                }
            }).start();
        }
    }

    /** System back: let the web UI pop its own screens first, then exit. */
    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript(
            "(function(){ try { if (window.__hsBack && window.__hsBack()) return 'true'; } catch(e){} return 'false'; })()",
            value -> {
                if (value == null || !value.contains("true")) finish();
            });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null) {
            onBackPressed();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /* ------------------------------------------------------------------ */

    private final class LocalClient extends WebViewClient {

        private boolean usedFallback = false;

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url == null) return null;
            String host = url.getHost();
            if (host == null || !host.equals(APP_HOST)) return null;

            String path = url.getPath() == null ? "" : url.getPath();
            while (path.startsWith("/")) path = path.substring(1);
            if (path.isEmpty() || path.endsWith("/")) path += "index.html";

            try {
                File over = overlayFile(path);
                if (over != null && over.isFile()) {
                    return new WebResourceResponse(mimeFor(path), "UTF-8", 200, "OK", headers(path),
                            new FileInputStream(over));
                }
            } catch (IOException e) {
                Log.w(TAG, "overlay read failed: " + path);
            }

            try {
                InputStream in = getAssets().open(path);
                return new WebResourceResponse(mimeFor(path), "UTF-8", 200, "OK", headers(path), in);
            } catch (IOException e) {
                Log.w(TAG, "asset miss: " + path);
                try {
                    InputStream fallback = getAssets().open("index.html");
                    return new WebResourceResponse("text/html", "UTF-8", 200, "OK", headers("index.html"), fallback);
                } catch (IOException ignored) {
                    return null;
                }
            }
        }

        /** Last-resort fallback: if asset interception ever fails, serve the app over file://. */
        private void fallbackToFile(WebView view) {
            if (usedFallback) return;
            usedFallback = true;
            Log.w(TAG, "falling back to file:///android_asset");
            try {
                view.getSettings().setAllowUniversalAccessFromFileURLs(true);
            } catch (Throwable ignored) { }
            view.loadUrl("file:///android_asset/index.html");
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && APP_HOST.equals(request.getUrl().getHost())) fallbackToFile(view);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (request.isForMainFrame() && APP_HOST.equals(request.getUrl().getHost())) fallbackToFile(view);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url == null) return false;
            if (APP_HOST.equals(url.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (Exception ignored) { }
            return true;
        }

        private Map<String, String> headers(String path) {
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-cache");
            return h;
        }

        private String mimeFor(String path) {
            String p = path.toLowerCase(Locale.US);
            if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
            if (p.endsWith(".js")) return "application/javascript";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".json")) return "application/json";
            if (p.endsWith(".webmanifest") || p.endsWith(".manifest")) return "application/manifest+json";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
            if (p.endsWith(".gif")) return "image/gif";
            if (p.endsWith(".webp")) return "image/webp";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".woff2")) return "font/woff2";
            if (p.endsWith(".woff")) return "font/woff";
            if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
            if (p.endsWith(".mp3")) return "audio/mpeg";
            if (p.endsWith(".wav")) return "audio/wav";
            if (p.endsWith(".ogg")) return "audio/ogg";
            if (p.endsWith(".mp4")) return "video/mp4";
            return "application/octet-stream";
        }
    }


    /* ================= self-update ================= */

    private File overlayDir() { return new File(getFilesDir(), OVERLAY); }

    /** Resolve a path inside the overlay, refusing anything that escapes it. */
    private File overlayFile(String path) {
        if (path == null || path.length() == 0 || path.startsWith("/")) return null;
        if (path.contains("..") || path.contains("\\")) return null;
        try {
            File f = new File(overlayDir(), path);
            String root = overlayDir().getCanonicalPath();
            String want = f.getCanonicalPath();
            if (!want.equals(root) && !want.startsWith(root + File.separator)) return null;
            return f;
        } catch (IOException e) { return null; }
    }

    private static String readFile(File f) {
        if (f == null || !f.isFile()) return null;
        BufferedReader r = null;
        try {
            StringBuilder sb = new StringBuilder();
            r = new BufferedReader(new FileReader(f));
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        } catch (Exception e) { return null; }
        finally { if (r != null) try { r.close(); } catch (IOException ignored) { } }
    }

    private static boolean writeFile(File f, String body) {
        try {
            f.getParentFile().mkdirs();
            FileOutputStream os = new FileOutputStream(f);
            os.write(body.getBytes("UTF-8"));
            os.flush();
            os.close();
            return true;
        } catch (Exception e) { return false; }
    }

    private static void deleteDir(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteDir(k);
        f.delete();
    }

    /** An update stamped for an older build is stale once the APK itself changes. */
    private void dropStaleOverlay() {
        try {
            if (!overlayDir().isDirectory()) return;
            String stamped = readFile(new File(getFilesDir(), OVERLAY_APK));
            String now = String.valueOf(getPackageManager().getPackageInfo(getPackageName(), 0).versionCode);
            if (stamped != null && !stamped.equals(now)) {
                deleteDir(overlayDir());
                Log.i(TAG, "dropped an overlay left over from build " + stamped);
            }
        } catch (Exception e) { Log.w(TAG, "overlay staleness check failed", e); }
    }

    /** If an update was applied but the app never got far enough to confirm it,
     *  undo it — otherwise a bad update would wedge the app for good. */
    private void rollbackIfBroken() {
        try {
            File pending = new File(getFilesDir(), OVERLAY_PENDING);
            if (!pending.exists()) return;
            if (System.currentTimeMillis() - pending.lastModified() < ROLLBACK_AFTER_MS) return;
            deleteDir(overlayDir());
            deleteDir(new File(getFilesDir(), "web.tmp"));
            Log.w(TAG, "rolled back an update that never started");
        } catch (Throwable t) { Log.w(TAG, "rollback check failed", t); }
    }

    private static String httpGet(String urlStr, File out, Job job) {
        HttpURLConnection c = null;
        InputStream in = null;
        OutputStream os = null;
        try {
            URL u = new URL(urlStr);
            String proto = u.getProtocol();
            if (!"https".equals(proto) && !"http".equals(proto)) return "Only http(s) addresses are supported";
            c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", "HordeStudioMobile");
            int code = c.getResponseCode();
            if (code == 401 || code == 403) return "The server refused the request (" + code +
                    "). That address looks protected - put one you control in Settings, "
                    + "or use Apply from a file, which needs no network at all.";
            if (code >= 400) return "The server answered " + code;
            int len = c.getContentLength();
            in = new BufferedInputStream(c.getInputStream());
            os = new FileOutputStream(out);
            byte[] buf = new byte[16384];
            long done = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                done += n;
                if (job != null && len > 0) job.progress = (int) (100L * done / len);
            }
            os.flush();
            return null;
        } catch (Exception e) {
            String m = e.getMessage();
            return (m == null || m.isEmpty()) ? e.toString() : m;
        } finally {
            if (os != null) try { os.close(); } catch (IOException ignored) { }
            if (in != null) try { in.close(); } catch (IOException ignored) { }
            if (c != null) c.disconnect();
        }
    }

    private static String unzip(File zip, File dest) {
        ZipInputStream zis = null;
        try {
            zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)));
            byte[] buf = new byte[16384];
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                String name = e.getName();
                if (name.contains("..") || name.startsWith("/")) continue;
                File f = new File(dest, name);
                if (e.isDirectory()) { f.mkdirs(); continue; }
                if (f.getParentFile() != null) f.getParentFile().mkdirs();
                FileOutputStream os = new FileOutputStream(f);
                int n;
                while ((n = zis.read(buf)) > 0) os.write(buf, 0, n);
                os.flush();
                os.close();
            }
            return null;
        } catch (Exception ex) {
            String m = ex.getMessage();
            return (m == null || m.isEmpty()) ? ex.toString() : m;
        } finally {
            if (zis != null) try { zis.close(); } catch (IOException ignored) { }
        }
    }

    /** A background download the web UI can poll. */
    private static final class Job {
        final int id;
        int progress;
        String state = "running";
        String message = "";
        String result = "";
        Job(int id) { this.id = id; }
    }

    private final Map<Integer, Job> jobs = new HashMap<>();
    private int nextJobId = 1;

    private Job newJob() {
        Job j = new Job(nextJobId++);
        synchronized (jobs) { jobs.put(j.id, j); }
        return j;
    }

    private static void jobFail(Job j, String message) {
        j.state = "error";
        j.message = message == null ? "failed" : message;
    }

    private static void jobDone(Job j, String result) {
        j.state = "done";
        j.progress = 100;
        j.result = result == null ? "" : result;
    }

    /* JSON is assembled by hand here; these keep quotes and newlines out of it
       without a single backslash in the source. */
    private static final String Q  = String.valueOf((char) 34);
    private static final String NL = String.valueOf((char) 10);
    private static final String CR = String.valueOf((char) 13);
    private static final String BS = String.valueOf((char) 92);

    private static String jsonEscape(String v) {
        if (v == null) return "";
        return v.replace(Q, "'").replace(BS, "'").replace(NL, " ").replace(CR, " ");
    }

    /** Lets the web UI write exports (backups, character cards, transcripts) to Downloads. */
    private final class NativeBridge {
        @JavascriptInterface
        public boolean saveFile(final String name, final String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, guessMime(name));
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/HordeStudio");
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return false;
                    OutputStream out = getContentResolver().openOutputStream(uri);
                    if (out == null) return false;
                    out.write(bytes);
                    out.flush();
                    out.close();
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, cv, null, null);
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS), "HordeStudio");
                    if (!dir.exists() && !dir.mkdirs()) return false;
                    File f = new File(dir, name);
                    FileOutputStream out = new FileOutputStream(f);
                    out.write(bytes);
                    out.flush();
                    out.close();
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Saved to Downloads/HordeStudio/" + name, Toast.LENGTH_SHORT).show());
                return true;
            } catch (Exception e) {
                Log.e(TAG, "saveFile failed", e);
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Save failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
                return false;
            }
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }

        /* ---- self-update ---- */

        /** What is installed right now: APK version, and which web revision is live. */
        @JavascriptInterface
        public String updateInfo() {
            String apk = "?", rev = "", overlay = "false";
            int code = 0;
            try {
                android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                apk = pi.versionName;
                code = pi.versionCode;
            } catch (Exception ignored) { }
            String r = readFile(new File(getFilesDir(), OVERLAY_REV));
            if (r != null && r.length() > 0) { rev = r.replace(Q, ""); overlay = "true"; }
            return "{" + Q + "apk" + Q + ":" + Q + apk + Q
                    + "," + Q + "apkCode" + Q + ":" + code
                    + "," + Q + "overlay" + Q + ":" + overlay
                    + "," + Q + "rev" + Q + ":" + Q + rev + Q + "}";
        }

        /** Fetch a version manifest so the UI can compare. Returns a job id. */
        @JavascriptInterface
        public int checkUpdate(final String url) {
            final Job job = newJob();
            new Thread(new Runnable() {
                @Override public void run() {
                    File tmp = new File(getCacheDir(), "hs-version.json");
                    String err = httpGet(url, tmp, job);
                    if (err != null) { jobFail(job, err); return; }
                    String body = readFile(tmp);
                    tmp.delete();
                    if (body == null || body.length() == 0) { jobFail(job, "The server sent nothing"); return; }
                    jobDone(job, body);
                }
            }).start();
            return job.id;
        }

        /** Download the web bundle and switch to it. Returns a job id. */
        @JavascriptInterface
        public int applyWebUpdate(final String zipUrl, final String rev) {
            final Job job = newJob();
            new Thread(new Runnable() {
                @Override public void run() {
                    File zip = new File(getCacheDir(), "hs-update.zip");
                    zip.delete();
                    String err = httpGet(zipUrl, zip, job);
                    if (err != null) { zip.delete(); jobFail(job, err); return; }
                    job.progress = 40;
                    finishSwap(zip, rev, job);
                }
            }).start();
            return job.id;
        }

        /** Called by the web UI once it has booted on a new bundle. */
        @JavascriptInterface
        public void confirmUpdate() {
            new File(getFilesDir(), OVERLAY_PENDING).delete();
        }

        /** Throw the overlay away and go back to the files bundled in the APK. */
        @JavascriptInterface
        public void clearWebUpdate() {
            deleteDir(overlayDir());
            deleteDir(new File(getFilesDir(), "web.tmp"));
        }

        @JavascriptInterface
        public String jobStatus(int id) {
            Job j;
            synchronized (jobs) { j = jobs.get(id); }
            if (j == null) return jsonError("no such job");
            String r = "{" + Q + "state" + Q + ":" + Q + j.state + Q
                    + "," + Q + "progress" + Q + ":" + j.progress
                    + "," + Q + "message" + Q + ":" + Q + jsonEscape(j.message) + Q
                    + "," + Q + "result" + Q + ":" + Q + jsonEscape(j.result) + Q + "}";
            if (!"running".equals(j.state)) synchronized (jobs) { jobs.remove(id); }
            return r;
        }

        private String jsonError(String msg) {
            return "{" + Q + "state" + Q + ":" + Q + "error" + Q
                    + "," + Q + "message" + Q + ":" + Q + jsonEscape(msg) + Q
                    + "," + Q + "progress" + Q + ":0"
                    + "," + Q + "result" + Q + ":" + Q + Q + "}";
        }

        /** Hand a new APK to Android's installer (only needed when the wrapper changes). */
        @JavascriptInterface
        public void installApk(final String url) {
            try {
                if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                    Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        startActivity(i);
                        toast("Allow installing from this source, then press Install again");
                    } catch (Exception e) {
                        toast("Allow installs from this source for Horde Studio in Android settings");
                    }
                    return;
                }
                final DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setTitle("Horde Studio update");
                r.setMimeType("application/vnd.android.package-archive");
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "HordeStudio-update.apk");
                final long id;
                try {
                    id = dm.enqueue(r);
                } catch (Exception e) {
                    toast("Could not start the download: " + e.getMessage());
                    return;
                }
                toast("Downloading the update…");
                registerReceiver(new BroadcastReceiver() {
                    @Override public void onReceive(Context ctx, Intent intent) {
                        if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                        try { unregisterReceiver(this); } catch (Throwable ignored) { }
                        Uri uri = dm.getUriForDownloadedFile(id);
                        if (uri == null) { toast("The download did not finish"); return; }
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(uri, "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(i); } catch (Exception e) { toast("Could not open the installer"); }
                    }
                }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            } catch (Exception e) {
                toast("Install failed: " + e.getMessage());
            }
        }

        /** Apply an update from a zip already on the phone - downloaded in a
         *  browser, sent over chat, copied from a computer. Needs no network at
         *  all, which is what makes it work when the update address is dead. */
        @JavascriptInterface
        public int pickUpdateZip() {
            final Job job = newJob();
            updateJob = job.id;
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                        i.setType("application/zip");
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        startActivityForResult(
                                Intent.createChooser(i, "Choose a Horde Studio update"), REQ_UPDATE);
                    } catch (Exception e) {
                        try {
                            Intent j = new Intent(Intent.ACTION_GET_CONTENT);
                            j.setType("*/*");
                            j.addCategory(Intent.CATEGORY_OPENABLE);
                            startActivityForResult(
                                    Intent.createChooser(j, "Choose a Horde Studio update"), REQ_UPDATE);
                        } catch (Exception e2) {
                            updateJob = 0;
                            jobFail(job, "No file picker is available on this device");
                        }
                    }
                }
            });
            return job.id;
        }

        /** Fallback when the in-app download is blocked: let the browser deal
         *  with it. Android's installer still asks before anything installs. */
        @JavascriptInterface
        public void openDownload(final String url) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                toast("Could not open the browser: " + e.getMessage());
            }
        }

        /** Validate a bundle and switch to it. Shared by the network route and
         *  the pick-a-file route, so both get exactly the same guarantees: the
         *  bundle is checked before anything moves, the swap is a single rename,
         *  and the rollback watchdog is armed. */
        private void finishSwap(File zip, String rev, Job job) {
            File tmp = new File(getFilesDir(), "web.tmp");
            deleteDir(tmp);
            String un = unzip(zip, tmp);
            zip.delete();
            if (un != null) { deleteDir(tmp); jobFail(job, un); return; }
            if (!new File(tmp, "index.html").isFile() || !new File(tmp, "js/app.js").isFile()) {
                deleteDir(tmp);
                jobFail(job, "That download is not a Horde Studio bundle");
                return;
            }
            File live = overlayDir();
            File keep = new File(getFilesDir(), "web.old");
            deleteDir(keep);
            if (live.exists()) live.renameTo(keep);
            if (!tmp.renameTo(live)) {
                if (keep.exists()) keep.renameTo(live);
                jobFail(job, "Could not swap in the new files");
                return;
            }
            deleteDir(keep);
            String code = "0";
            try {
                code = String.valueOf(getPackageManager().getPackageInfo(getPackageName(), 0).versionCode);
            } catch (Exception ignored) { }
            String safeRev = (rev == null || rev.length() == 0)
                    ? String.valueOf(System.currentTimeMillis()) : jsonEscape(rev);
            writeFile(new File(getFilesDir(), OVERLAY_REV), safeRev);
            writeFile(new File(getFilesDir(), OVERLAY_APK), code);
            writeFile(new File(getFilesDir(), OVERLAY_PENDING), String.valueOf(System.currentTimeMillis()));
            job.progress = 100;
            jobDone(job, safeRev);
        }

        /** The revision a bundle claims, read without a JSON parser. Empty if
         *  the bundle does not say, in which case the caller invents one. */
        private String revFromBundle(File zip) {
            ZipFile zf = null;
            try {
                zf = new ZipFile(zip);
                ZipEntry e = zf.getEntry("version.json");
                if (e == null) return "";
                InputStream in = zf.getInputStream(e);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                String body = new String(out.toByteArray(), "UTF-8");
                int i = body.indexOf("webRev");
                if (i < 0) return "";
                int c = body.indexOf(':', i);
                if (c < 0) return "";
                int q = body.indexOf('"', c + 1);
                if (q < 0) return "";
                int end = body.indexOf('"', q + 1);
                if (end < 0) return "";
                return body.substring(q + 1, end);
            } catch (Exception ignored) {
                return "";
            } finally {
                if (zf != null) try { zf.close(); } catch (Exception ignored) { }
            }
        }

        private void toast(final String msg) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            });
        }

        private String guessMime(String name) {
            String n = name == null ? "" : name.toLowerCase(Locale.US);
            if (n.endsWith(".json")) return "application/json";
            if (n.endsWith(".png")) return "image/png";
            if (n.endsWith(".txt") || n.endsWith(".md")) return "text/plain";
            return "application/octet-stream";
        }
    }
}
