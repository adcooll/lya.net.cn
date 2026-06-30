on run argv
	if (count of argv) < 2 then error "Usage: osascript scripts/export_photos_album.applescript \"Album Name\" \"/absolute/output/folder\""
	set albumName to item 1 of argv
	set outputPath to item 2 of argv
	set outputFolder to POSIX file outputPath

	tell application "Finder"
		if not (exists outputFolder) then
			make new folder at (POSIX file (do shell script "dirname " & quoted form of outputPath)) with properties {name:(do shell script "basename " & quoted form of outputPath)}
		end if
	end tell

	tell application "Photos"
		set sourceAlbum to album albumName
		set albumItems to media items of sourceAlbum
		export albumItems to outputFolder
		return (count of albumItems) as text
	end tell
end run
