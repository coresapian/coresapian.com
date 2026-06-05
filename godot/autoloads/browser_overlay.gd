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

	# Use JSON.stringify to safely escape strings for JS embedding.
	# This handles all special characters including quotes, backslashes, and unicode.
	var safe_url := JSON.stringify(url)
	var safe_title := JSON.stringify(title)

	JavaScriptBridge.eval(
		"window.__coresapianShowBrowser(%s, %s)" % [safe_url, safe_title]
	)


func close_browser() -> void:
	if not OS.has_feature("web"):
		return

	JavaScriptBridge.eval("window.__coresapianCloseBrowser()")
