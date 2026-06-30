import AppKit
import Foundation
import Photos

struct Options {
    var listAlbums = false
    var albumName: String?
    var outputDir = "media/public/photos-app"
    var limit = 80
    var includeVideos = false
    var dryRun = false
}

struct ManifestItem: Encodable {
    let id: String
    let type: String
    let title: String
    let album: String
    let date: String
    let location: String
    let description: String
    let tags: [String]
    let src: String
    let thumb: String
    let width: Int
    let height: Int
    let featured: Bool?
}

enum ExportError: Error, CustomStringConvertible {
    case missingValue(String)
    case unknownArgument(String)
    case albumRequired
    case albumNotFound(String)
    case photosDenied
    case imageEncodingFailed(String)
    case resourceMissing(String)

    var description: String {
        switch self {
        case .missingValue(let flag):
            return "Missing value for \(flag)"
        case .unknownArgument(let value):
            return "Unknown argument: \(value)"
        case .albumRequired:
            return "Use --album \"相册名\" to choose a Photos album to export."
        case .albumNotFound(let name):
            return "Album not found: \(name)"
        case .photosDenied:
            return "Photos permission was denied or unavailable."
        case .imageEncodingFailed(let id):
            return "Failed to encode image for asset \(id)"
        case .resourceMissing(let id):
            return "No original resource found for video asset \(id)"
        }
    }
}

let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withFullDate]
    return formatter
}()

func parseOptions() throws -> Options {
    var options = Options()
    var args = Array(CommandLine.arguments.dropFirst())

    while !args.isEmpty {
        let arg = args.removeFirst()
        switch arg {
        case "--list-albums":
            options.listAlbums = true
        case "--album":
            guard !args.isEmpty else { throw ExportError.missingValue(arg) }
            options.albumName = args.removeFirst()
        case "--output":
            guard !args.isEmpty else { throw ExportError.missingValue(arg) }
            options.outputDir = args.removeFirst()
        case "--limit":
            guard !args.isEmpty else { throw ExportError.missingValue(arg) }
            options.limit = Int(args.removeFirst()) ?? options.limit
        case "--include-videos":
            options.includeVideos = true
        case "--dry-run":
            options.dryRun = true
        case "--help", "-h":
            printUsage()
            Foundation.exit(0)
        default:
            throw ExportError.unknownArgument(arg)
        }
    }

    return options
}

func printUsage() {
    print("""
    Usage:
      export_photos --list-albums
      export_photos --album "Album Name" [--limit 80] [--include-videos] [--output media/public/photos-app]

    Tips:
      Create a child-only album in Photos first, then export that album.
      This tool does not upload anything; it reads Photos locally through PhotoKit.
    """)
}

func requestAuthorization() throws {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
        granted = status == .authorized || status == .limited
        semaphore.signal()
    }
    semaphore.wait()
    if !granted {
        throw ExportError.photosDenied
    }
}

func fetchAlbums() -> [PHAssetCollection] {
    var albums: [PHAssetCollection] = []
    let userAlbums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
    userAlbums.enumerateObjects { collection, _, _ in
        albums.append(collection)
    }
    let smartAlbums = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .any, options: nil)
    smartAlbums.enumerateObjects { collection, _, _ in
        albums.append(collection)
    }
    return albums
}

func countAssets(in collection: PHAssetCollection, includeVideos: Bool) -> Int {
    let options = PHFetchOptions()
    if !includeVideos {
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
    }
    return PHAsset.fetchAssets(in: collection, options: options).count
}

func listAlbums(includeVideos: Bool) {
    let albums = fetchAlbums()
        .map { collection in
            (collection.localizedTitle ?? "Untitled", countAssets(in: collection, includeVideos: includeVideos))
        }
        .filter { $0.1 > 0 }
        .sorted { lhs, rhs in
            if lhs.1 == rhs.1 { return lhs.0.localizedCaseInsensitiveCompare(rhs.0) == .orderedAscending }
            return lhs.1 > rhs.1
        }

    for (name, count) in albums {
        print("\(count)\t\(name)")
    }
}

func findAlbum(named name: String) -> PHAssetCollection? {
    fetchAlbums().first { collection in
        collection.localizedTitle == name
    }
}

func fetchAssets(in collection: PHAssetCollection, includeVideos: Bool, limit: Int) -> [PHAsset] {
    let options = PHFetchOptions()
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    if !includeVideos {
        options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
    } else {
        options.predicate = NSPredicate(
            format: "mediaType == %d OR mediaType == %d",
            PHAssetMediaType.image.rawValue,
            PHAssetMediaType.video.rawValue
        )
    }

    let result = PHAsset.fetchAssets(in: collection, options: options)
    var assets: [PHAsset] = []
    result.enumerateObjects { asset, index, stop in
        if index >= limit {
            stop.pointee = true
            return
        }
        assets.append(asset)
    }
    return assets
}

func sanitized(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    let scalars = value.unicodeScalars.map { scalar in
        allowed.contains(scalar) ? Character(scalar) : "-"
    }
    let joined = String(scalars)
    let collapsed = joined.replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
    return collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "-_")).lowercased()
}

func relativePath(from root: URL, to file: URL) -> String {
    let rootPath = root.standardizedFileURL.path
    let filePath = file.standardizedFileURL.path
    if filePath.hasPrefix(rootPath) {
        return String(filePath.dropFirst(rootPath.count + 1))
    }
    return filePath
}

func imageData(for asset: PHAsset, size: CGSize, quality: CGFloat) throws -> Data {
    let manager = PHImageManager.default()
    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .exact
    options.isNetworkAccessAllowed = true

    var image: NSImage?
    manager.requestImage(
        for: asset,
        targetSize: size,
        contentMode: .aspectFill,
        options: options
    ) { result, _ in
        image = result
    }

    guard let image, let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality]) else {
        throw ExportError.imageEncodingFailed(asset.localIdentifier)
    }
    return data
}

func exportImage(asset: PHAsset, baseName: String, outputURL: URL) throws -> (src: URL, thumb: URL) {
    let fullURL = outputURL.appendingPathComponent("\(baseName).jpg")
    let thumbURL = outputURL.appendingPathComponent("\(baseName)-thumb.jpg")
    let longEdge = max(asset.pixelWidth, asset.pixelHeight)
    let scale = longEdge > 1800 ? CGFloat(1800) / CGFloat(longEdge) : 1
    let fullSize = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
    let thumbScale = longEdge > 900 ? CGFloat(900) / CGFloat(longEdge) : 1
    let thumbSize = CGSize(width: CGFloat(asset.pixelWidth) * thumbScale, height: CGFloat(asset.pixelHeight) * thumbScale)

    try imageData(for: asset, size: fullSize, quality: 0.86).write(to: fullURL)
    try imageData(for: asset, size: thumbSize, quality: 0.76).write(to: thumbURL)
    return (fullURL, thumbURL)
}

func videoResource(for asset: PHAsset) throws -> PHAssetResource {
    let resources = PHAssetResource.assetResources(for: asset)
    if let resource = resources.first(where: { $0.type == .video || $0.type == .fullSizeVideo }) {
        return resource
    }
    throw ExportError.resourceMissing(asset.localIdentifier)
}

func exportVideo(asset: PHAsset, baseName: String, outputURL: URL) throws -> (src: URL, thumb: URL) {
    let resource = try videoResource(for: asset)
    let originalExtension = URL(fileURLWithPath: resource.originalFilename).pathExtension
    let ext = originalExtension.isEmpty ? "mov" : originalExtension.lowercased()
    let videoURL = outputURL.appendingPathComponent("\(baseName).\(ext)")
    let thumbURL = outputURL.appendingPathComponent("\(baseName).jpg")

    let semaphore = DispatchSemaphore(value: 0)
    var writeError: Error?
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = true
    PHAssetResourceManager.default().writeData(for: resource, toFile: videoURL, options: options) { error in
        writeError = error
        semaphore.signal()
    }
    semaphore.wait()
    if let writeError { throw writeError }

    try imageData(for: asset, size: CGSize(width: 900, height: 900), quality: 0.74).write(to: thumbURL)
    return (videoURL, thumbURL)
}

func exportAlbum(_ album: PHAssetCollection, options: Options) throws {
    let rootURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    let outputURL = rootURL.appendingPathComponent(options.outputDir, isDirectory: true)
    if !options.dryRun {
        try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
    }

    let albumName = album.localizedTitle ?? "Photos"
    let assets = fetchAssets(in: album, includeVideos: options.includeVideos, limit: options.limit)
    var manifest: [ManifestItem] = []

    for (index, asset) in assets.enumerated() {
        let date = asset.creationDate ?? Date()
        let dateString = isoFormatter.string(from: date)
        let id = sanitized(asset.localIdentifier.replacingOccurrences(of: "/", with: "-"))
        let baseName = "\(dateString)-\(String(format: "%03d", index + 1))-\(id)"
        let mediaType = asset.mediaType == .video ? "video" : "photo"
        let title = "\(albumName) \(index + 1)"

        if options.dryRun {
            print("\(mediaType)\t\(dateString)\t\(asset.pixelWidth)x\(asset.pixelHeight)\t\(asset.localIdentifier)")
            continue
        }

        let exported: (src: URL, thumb: URL)
        if asset.mediaType == .video {
            exported = try exportVideo(asset: asset, baseName: baseName, outputURL: outputURL)
        } else {
            exported = try exportImage(asset: asset, baseName: baseName, outputURL: outputURL)
        }

        manifest.append(
            ManifestItem(
                id: baseName,
                type: mediaType,
                title: title,
                album: albumName,
                date: dateString,
                location: "家",
                description: "从 Mac 照片 App 的「\(albumName)」相册导出的发布版素材。",
                tags: ["孩子"],
                src: relativePath(from: rootURL, to: exported.src),
                thumb: relativePath(from: rootURL, to: exported.thumb),
                width: max(asset.pixelWidth, 1),
                height: max(asset.pixelHeight, 1),
                featured: index == 0 ? true : nil
            )
        )
        print("Exported \(index + 1)/\(assets.count): \(relativePath(from: rootURL, to: exported.src))")
    }

    if !options.dryRun {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let data = try encoder.encode(manifest)
        try data.write(to: outputURL.appendingPathComponent("photos-app-manifest.json"))
        print("Exported \(manifest.count) items to \(options.outputDir)")
    }
}

do {
    let options = try parseOptions()
    try requestAuthorization()

    if options.listAlbums {
        listAlbums(includeVideos: options.includeVideos)
        Foundation.exit(0)
    }

    guard let albumName = options.albumName else {
        throw ExportError.albumRequired
    }
    guard let album = findAlbum(named: albumName) else {
        throw ExportError.albumNotFound(albumName)
    }
    try exportAlbum(album, options: options)
} catch {
    fputs("Error: \(error)\n", stderr)
    printUsage()
    Foundation.exit(1)
}
