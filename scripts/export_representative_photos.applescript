on run argv
	if (count of argv) < 1 then error "Usage: osascript scripts/export_representative_photos.applescript \"/absolute/output/folder\""

	set outputPath to item 1 of argv
	set outputFolder to POSIX file outputPath
	set listOnly to (count of argv) > 1 and item 2 of argv is "--list"
	set searchTerms to {"家庭", "母亲", "父亲", "妈妈", "爸爸"}
	set chosenItems to {}
	set bucketKeys to {}
	set bucketItems to {}
	set bucketScores to {}

	set referenceDate to current date
	set year of referenceDate to 2000
	set month of referenceDate to January
	set day of referenceDate to 1
	set time of referenceDate to 0

	tell application "Photos"
		repeat with searchTerm in searchTerms
			set foundItems to search for (searchTerm as text)

			repeat with photoItem in foundItems
				set assetFileName to (get filename of photoItem)
				set isVideo to false
				ignoring case
					if assetFileName ends with ".mov" or assetFileName ends with ".mp4" or assetFileName ends with ".m4v" then set isVideo to true
				end ignoring

				if not isVideo then
					set takenDate to date of photoItem
					set weekKey to ((takenDate - referenceDate) div (7 * days)) as integer
					set photoScore to (width of photoItem) * (height of photoItem)
					if favorite of photoItem then set photoScore to photoScore + 100000000

					set bucketIndex to 0
					repeat with i from 1 to count of bucketKeys
						if item i of bucketKeys is weekKey then
							set bucketIndex to i
							exit repeat
						end if
					end repeat

					if bucketIndex is 0 then
						set end of bucketKeys to weekKey
						set end of bucketItems to photoItem
						set end of bucketScores to photoScore
					else if photoScore > item bucketIndex of bucketScores then
						set item bucketIndex of bucketItems to photoItem
						set item bucketIndex of bucketScores to photoScore
					end if
				end if
			end repeat
		end repeat
		set chosenItems to bucketItems

		if listOnly then
			set outputText to ""
			repeat with photoItem in chosenItems
				set takenDate to date of photoItem
				set dateText to (year of takenDate as text) & "-" & text -2 thru -1 of ("0" & (month of takenDate as integer)) & "-" & text -2 thru -1 of ("0" & day of takenDate)
				set outputText to outputText & id of photoItem & tab & (get filename of photoItem) & tab & dateText & linefeed
			end repeat
			return outputText
		end if

		export chosenItems to outputFolder using originals false
	end tell

	return (count of chosenItems) as text
end run
