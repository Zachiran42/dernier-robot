package fr.zachiran.robot;
import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.webkit.*;
import android.net.Uri;
import java.io.ByteArrayInputStream;
import java.util.HashMap;

/** Local-only WebView host. No network permission and no JavaScript bridge. */
public final class MainActivity extends Activity {
 private WebView web;
 private static final String HOST="appassets.androidplatform.net";
 @Override public void onCreate(Bundle bundle) {
  super.onCreate(bundle);
  getWindow().setStatusBarColor(Color.rgb(12,18,22));
  getWindow().setNavigationBarColor(Color.rgb(12,18,22));
  web=new WebView(this);web.setBackgroundColor(Color.rgb(12,18,22));
  setContentView(web);
  web.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
  web.requestApplyInsets();
  WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(false);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setMediaPlaybackRequiresUserGesture(true);
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){return !isLocal(req.getUrl());}
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest req){
    Uri u=req.getUrl();if(!isLocal(u))return denied();
    String p=u.getPath().substring(8);
    if(p.isEmpty()||p.contains("..")||p.contains("\\"))return denied();
    String mime=p.endsWith(".js")?"application/javascript":p.endsWith(".css")?"text/css":p.endsWith(".svg")?"image/svg+xml":"text/html";
    try{HashMap<String,String> h=new HashMap<>();h.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'");return new WebResourceResponse(mime,"UTF-8",200,"OK",h,getAssets().open(p));}catch(Exception e){return denied();}
   }
  });
  web.loadUrl("https://"+HOST+"/assets/index.html?native=1");
 }
 private static boolean isLocal(Uri u){return "https".equals(u.getScheme())&&HOST.equals(u.getHost())&&u.getPath()!=null&&u.getPath().startsWith("/assets/");}
 private static WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",new HashMap<>(),new ByteArrayInputStream(new byte[0]));}
 @Override protected void onPause(){web.evaluateJavascript("window.__pauseGame&&window.__pauseGame()",null);web.onPause();super.onPause();}
 @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
 @Override public void onBackPressed(){web.evaluateJavascript("window.__handleBack?window.__handleBack():false",value->{if(!"true".equals(value))finish();});}
 @Override protected void onDestroy(){web.destroy();super.onDestroy();}
}
