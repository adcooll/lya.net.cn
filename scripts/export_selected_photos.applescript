on run argv
	if (count of argv) < 1 then error "Usage: osascript scripts/export_selected_photos.applescript \"/absolute/output/folder\""
	set outputPath to item 1 of argv
	set outputFolder to POSIX file outputPath

	tell application "Finder"
		if not (exists outputFolder) then
			make new folder at (POSIX file (do shell script "dirname " & quoted form of outputPath)) with properties {name:(do shell script "basename " & quoted form of outputPath)}
		end if
	end tell

	tell application "Photos"
		set selectedItems to selection
		if selectedItems is {} then error "No selected Photos items. Open the LYA album in Photos and select the items first."
		export selectedItems to outputFolder
		return (count of selectedItems) as text
	end tell
end run
