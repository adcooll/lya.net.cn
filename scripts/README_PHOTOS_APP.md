# Photos App Export

These scripts use macOS Photos automation locally. They do not upload images or videos.

## List Albums

```bash
osascript scripts/list_photos_albums.applescript
```

## Export One Child-Only Album

Create or choose an album in Photos that contains only child photos/videos you want to publish.

```bash
mkdir -p media/public/photos-app
osascript scripts/export_photos_album.applescript "Album Name" "$PWD/media/public/photos-app"
python3 scripts/generate_manifest.py
cp photos.generated.js photos.js
```

Then refresh the website.

## Privacy Notes

- Do not export the whole library.
- Prefer a child-only album that you manually checked.
- Remove adults, other children, school names, addresses, plates, documents, and precise location clues before publishing.
