extends Node

## BrowserOverlay — Opens web pages as iframe overlays on top of the game.
## Only works on web exports (HTML5). On native platforms, logs a warning.
##
## Usage:
##   BrowserOverlay.open_browser("/core_truths_book/", "Core Truths")
##   BrowserOverlay.close_browser()


func open_browser(url: String, title: String = "Browser") -> void:
	if not OS.has_feature("web"):
		push_warning("Browser overlay: only available on web export (url=%s)" % url)
		return

	# Escape single quotes in strings for JS embedding
	var safe_url := url.replace("'", "\\'")
	var safe_title := title.replace("'", "\\'")

	JavaScriptBridge.eval(
		"window.__coresapianShowBrowser('%s', '%s')" % [safe_url, safe_title]
	)


func close_browser() -> void:
	if not OS.has_feature("web"):
		return

	JavaScriptBridge.eval("window.__coresapianCloseBrowser()")
