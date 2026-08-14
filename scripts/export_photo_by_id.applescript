on run argv
	if (count of argv) < 2 then error "Usage: osascript scripts/export_photo_by_id.applescript \"asset-id\" \"/absolute/output/folder\""

	set assetID to item 1 of argv
	set outputFolder to POSIX file (item 2 of argv)

	tell application "Photos"
		set photoItem to media item id assetID
		export {photoItem} to outputFolder using originals false
		return filename of photoItem
	end tell
end run
