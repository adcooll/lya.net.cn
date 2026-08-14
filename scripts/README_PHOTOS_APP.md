# Photos App Export

These scripts use macOS Photos automation locally. They do not upload images or videos.

## List Albums

```bash
osascript scripts/list_photos_albums.applescript
```

## Export One Curated Album

Create or choose an album in Photos that contains the child photos/videos you want to publish. Photos with adults are allowed when a child is also present.

```bash
mkdir -p media/public/photos-app
osascript scripts/export_photos_album.applescript "Album Name" "$PWD/media/public/photos-app"
python3 scripts/generate_manifest.py
cp photos.generated.js photos.js
```

Then refresh the website.

## Export Representative Candidates

To avoid publishing many near-identical photos, this script combines Photos searches for `家庭`, `母亲`, `父亲`, `妈妈`, and `爸爸`, then chooses at most one result per week. These searches intentionally target child-and-adult family photos. It exports rendered JPEG files and does not modify the Photos library.

```bash
mkdir -p /tmp/lya-representative-photos
osascript scripts/export_representative_photos.applescript "/tmp/lya-representative-photos"
```

Compare the exported candidates with the website's existing perceptual hashes before copying any files into `media/public/photos-app`.

If a batch export waits on an iCloud-only item, list the selected asset IDs and export them individually so one unavailable file cannot block the rest:

```bash
osascript scripts/export_representative_photos.applescript "/tmp/lya-representative-photos" --list
osascript scripts/export_photo_by_id.applescript "asset-id" "/tmp/lya-representative-photos"
```

## Privacy Notes

- Do not export the whole library.
- Every published photo must contain at least one of the two children; photos with adults are allowed.
- Keep only one representative image from a burst or highly similar scene.
- Remove unrelated children, school names, addresses, plates, documents, and precise location clues before publishing.
