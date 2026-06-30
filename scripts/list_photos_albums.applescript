set outputText to ""

tell application "Photos"
	repeat with albumItem in albums
		set albumName to name of albumItem
		set itemCount to count of media items of albumItem
		if itemCount > 0 then
			set outputText to outputText & itemCount & tab & albumName & linefeed
		end if
	end repeat
end tell

return outputText
