#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Photos/Photos.h>

typedef struct {
    BOOL listAlbums;
    NSString *albumName;
    NSString *outputDir;
    NSInteger limit;
    BOOL includeVideos;
    BOOL dryRun;
} Options;

static void PrintUsage(void) {
    printf("Usage:\n");
    printf("  export_photos_objc --list-albums [--include-videos]\n");
    printf("  export_photos_objc --album \"Album Name\" [--limit 80] [--include-videos] [--output media/public/photos-app]\n");
}

static NSString *ValueAfter(NSArray<NSString *> *args, NSUInteger *index, NSString *flag) {
    if (*index + 1 >= args.count) {
        fprintf(stderr, "Missing value for %s\n", flag.UTF8String);
        exit(1);
    }
    *index += 1;
    return args[*index];
}

static Options ParseOptions(int argc, const char *argv[]) {
    Options options;
    options.listAlbums = argc <= 1 ? YES : NO;
    options.albumName = nil;
    options.outputDir = @"media/public/photos-app";
    options.limit = 80;
    options.includeVideos = NO;
    options.dryRun = NO;

    NSMutableArray<NSString *> *args = [NSMutableArray array];
    for (int i = 1; i < argc; i++) {
        [args addObject:[NSString stringWithUTF8String:argv[i]]];
    }

    for (NSUInteger i = 0; i < args.count; i++) {
        NSString *arg = args[i];
        if ([arg isEqualToString:@"--list-albums"]) {
            options.listAlbums = YES;
        } else if ([arg isEqualToString:@"--album"]) {
            options.albumName = ValueAfter(args, &i, arg);
        } else if ([arg isEqualToString:@"--output"]) {
            options.outputDir = ValueAfter(args, &i, arg);
        } else if ([arg isEqualToString:@"--limit"]) {
            options.limit = [ValueAfter(args, &i, arg) integerValue];
        } else if ([arg isEqualToString:@"--include-videos"]) {
            options.includeVideos = YES;
        } else if ([arg isEqualToString:@"--dry-run"]) {
            options.dryRun = YES;
        } else if ([arg isEqualToString:@"--help"] || [arg isEqualToString:@"-h"]) {
            PrintUsage();
            exit(0);
        } else {
            fprintf(stderr, "Unknown argument: %s\n", arg.UTF8String);
            PrintUsage();
            exit(1);
        }
    }
    return options;
}

static NSString *AuthorizationStatusName(PHAuthorizationStatus status) {
    switch (status) {
        case PHAuthorizationStatusNotDetermined:
            return @"notDetermined";
        case PHAuthorizationStatusRestricted:
            return @"restricted";
        case PHAuthorizationStatusDenied:
            return @"denied";
        case PHAuthorizationStatusAuthorized:
            return @"authorized";
        case PHAuthorizationStatusLimited:
            return @"limited";
    }
    return @"unknown";
}

static BOOL RequestPhotosAccess(void) {
    if (@available(macOS 11.0, *)) {
        PHAuthorizationStatus current = [PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelReadWrite];
        if (current == PHAuthorizationStatusAuthorized || current == PHAuthorizationStatusLimited) {
            return YES;
        }
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block PHAuthorizationStatus requested = current;
        [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelReadWrite handler:^(PHAuthorizationStatus status) {
            requested = status;
            dispatch_semaphore_signal(semaphore);
        }];
        dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
        if (requested != PHAuthorizationStatusAuthorized && requested != PHAuthorizationStatusLimited) {
            fprintf(stderr, "Photos authorization status: %s\n", AuthorizationStatusName(requested).UTF8String);
        }
        return requested == PHAuthorizationStatusAuthorized || requested == PHAuthorizationStatusLimited;
    }

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block PHAuthorizationStatus requested = PHAuthorizationStatusNotDetermined;
    [PHPhotoLibrary requestAuthorization:^(PHAuthorizationStatus status) {
        requested = status;
        dispatch_semaphore_signal(semaphore);
    }];
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    if (requested != PHAuthorizationStatusAuthorized && requested != PHAuthorizationStatusLimited) {
        fprintf(stderr, "Photos authorization status: %s\n", AuthorizationStatusName(requested).UTF8String);
    }
    return requested == PHAuthorizationStatusAuthorized || requested == PHAuthorizationStatusLimited;
}

static NSArray<PHAssetCollection *> *FetchAlbums(void) {
    NSMutableArray<PHAssetCollection *> *albums = [NSMutableArray array];
    PHFetchResult<PHAssetCollection *> *userAlbums = [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeAlbum subtype:PHAssetCollectionSubtypeAny options:nil];
    [userAlbums enumerateObjectsUsingBlock:^(PHAssetCollection *collection, NSUInteger idx, BOOL *stop) {
        [albums addObject:collection];
    }];
    PHFetchResult<PHAssetCollection *> *smartAlbums = [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum subtype:PHAssetCollectionSubtypeAny options:nil];
    [smartAlbums enumerateObjectsUsingBlock:^(PHAssetCollection *collection, NSUInteger idx, BOOL *stop) {
        [albums addObject:collection];
    }];
    return albums;
}

static PHFetchOptions *AssetFetchOptions(BOOL includeVideos) {
    PHFetchOptions *fetchOptions = [[PHFetchOptions alloc] init];
    fetchOptions.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"creationDate" ascending:NO]];
    if (includeVideos) {
        fetchOptions.predicate = [NSPredicate predicateWithFormat:@"mediaType == %d OR mediaType == %d", PHAssetMediaTypeImage, PHAssetMediaTypeVideo];
    } else {
        fetchOptions.predicate = [NSPredicate predicateWithFormat:@"mediaType == %d", PHAssetMediaTypeImage];
    }
    return fetchOptions;
}

static NSUInteger CountAssets(PHAssetCollection *collection, BOOL includeVideos) {
    return [PHAsset fetchAssetsInAssetCollection:collection options:AssetFetchOptions(includeVideos)].count;
}

static void ListAlbums(BOOL includeVideos) {
    NSArray<PHAssetCollection *> *albums = FetchAlbums();
    NSMutableArray<NSDictionary *> *rows = [NSMutableArray array];
    for (PHAssetCollection *collection in albums) {
        NSUInteger count = CountAssets(collection, includeVideos);
        if (count == 0) { continue; }
        NSString *name = collection.localizedTitle ?: @"Untitled";
        [rows addObject:@{@"name": name, @"count": @(count)}];
    }
    [rows sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        NSInteger countA = [a[@"count"] integerValue];
        NSInteger countB = [b[@"count"] integerValue];
        if (countA == countB) {
            return [a[@"name"] localizedCaseInsensitiveCompare:b[@"name"]];
        }
        return countA < countB ? NSOrderedDescending : NSOrderedAscending;
    }];
    for (NSDictionary *row in rows) {
        printf("%ld\t%s\n", (long)[row[@"count"] integerValue], [row[@"name"] UTF8String]);
    }
}

static PHAssetCollection *FindAlbum(NSString *albumName) {
    for (PHAssetCollection *collection in FetchAlbums()) {
        if ([collection.localizedTitle isEqualToString:albumName]) {
            return collection;
        }
    }
    return nil;
}

static NSString *Sanitize(NSString *value) {
    NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"];
    NSMutableString *result = [NSMutableString string];
    for (NSUInteger i = 0; i < value.length; i++) {
        unichar c = [value characterAtIndex:i];
        if ([allowed characterIsMember:c]) {
            [result appendFormat:@"%C", c];
        } else {
            [result appendString:@"-"];
        }
    }
    while ([result containsString:@"--"]) {
        [result replaceOccurrencesOfString:@"--" withString:@"-" options:0 range:NSMakeRange(0, result.length)];
    }
    return [[result stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"-_"]] lowercaseString];
}

static NSString *ISODate(NSDate *date) {
    static NSDateFormatter *formatter = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        formatter = [[NSDateFormatter alloc] init];
        formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
        formatter.dateFormat = @"yyyy-MM-dd";
    });
    return [formatter stringFromDate:date ?: [NSDate date]];
}

static NSString *RelativePath(NSString *root, NSString *path) {
    NSString *standardRoot = root.stringByStandardizingPath;
    NSString *standardPath = path.stringByStandardizingPath;
    if ([standardPath hasPrefix:standardRoot]) {
        NSUInteger start = standardRoot.length + 1;
        if (standardPath.length > start) {
            return [standardPath substringFromIndex:start];
        }
    }
    return standardPath;
}

static NSData *JPEGDataForAsset(PHAsset *asset, CGSize targetSize, CGFloat quality) {
    PHImageRequestOptions *options = [[PHImageRequestOptions alloc] init];
    options.synchronous = YES;
    options.networkAccessAllowed = YES;
    options.deliveryMode = PHImageRequestOptionsDeliveryModeHighQualityFormat;
    options.resizeMode = PHImageRequestOptionsResizeModeExact;

    __block NSImage *image = nil;
    [[PHImageManager defaultManager] requestImageForAsset:asset targetSize:targetSize contentMode:PHImageContentModeAspectFit options:options resultHandler:^(NSImage *result, NSDictionary *info) {
        image = result;
    }];
    if (!image) { return nil; }

    NSData *tiffData = image.TIFFRepresentation;
    NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:tiffData];
    return [bitmap representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor: @(quality)}];
}

static BOOL ExportImage(PHAsset *asset, NSString *baseName, NSString *outputDir, NSString **src, NSString **thumb) {
    NSString *srcPath = [outputDir stringByAppendingPathComponent:[baseName stringByAppendingString:@".jpg"]];
    NSString *thumbPath = [outputDir stringByAppendingPathComponent:[baseName stringByAppendingString:@"-thumb.jpg"]];
    CGFloat longEdge = MAX(asset.pixelWidth, asset.pixelHeight);
    CGFloat fullScale = longEdge > 1800 ? 1800.0 / longEdge : 1.0;
    CGFloat thumbScale = longEdge > 900 ? 900.0 / longEdge : 1.0;

    NSData *fullData = JPEGDataForAsset(asset, CGSizeMake(asset.pixelWidth * fullScale, asset.pixelHeight * fullScale), 0.86);
    NSData *thumbData = JPEGDataForAsset(asset, CGSizeMake(asset.pixelWidth * thumbScale, asset.pixelHeight * thumbScale), 0.76);
    if (!fullData || !thumbData) { return NO; }
    [fullData writeToFile:srcPath atomically:YES];
    [thumbData writeToFile:thumbPath atomically:YES];
    *src = srcPath;
    *thumb = thumbPath;
    return YES;
}

static PHAssetResource *VideoResource(PHAsset *asset) {
    for (PHAssetResource *resource in [PHAssetResource assetResourcesForAsset:asset]) {
        if (resource.type == PHAssetResourceTypeVideo || resource.type == PHAssetResourceTypeFullSizeVideo) {
            return resource;
        }
    }
    return nil;
}

static BOOL ExportVideo(PHAsset *asset, NSString *baseName, NSString *outputDir, NSString **src, NSString **thumb) {
    PHAssetResource *resource = VideoResource(asset);
    if (!resource) { return NO; }
    NSString *ext = resource.originalFilename.pathExtension.lowercaseString;
    if (ext.length == 0) { ext = @"mov"; }
    NSString *videoPath = [outputDir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@.%@", baseName, ext]];
    NSString *thumbPath = [outputDir stringByAppendingPathComponent:[baseName stringByAppendingString:@".jpg"]];

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block NSError *writeError = nil;
    PHAssetResourceRequestOptions *options = [[PHAssetResourceRequestOptions alloc] init];
    options.networkAccessAllowed = YES;
    [[PHAssetResourceManager defaultManager] writeDataForAssetResource:resource toFile:[NSURL fileURLWithPath:videoPath] options:options completionHandler:^(NSError *error) {
        writeError = error;
        dispatch_semaphore_signal(semaphore);
    }];
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    if (writeError) {
        fprintf(stderr, "Video export error: %s\n", writeError.localizedDescription.UTF8String);
        return NO;
    }
    NSData *thumbData = JPEGDataForAsset(asset, CGSizeMake(900, 900), 0.74);
    if (thumbData) {
        [thumbData writeToFile:thumbPath atomically:YES];
    }
    *src = videoPath;
    *thumb = thumbPath;
    return YES;
}

static void ExportAlbum(PHAssetCollection *album, Options options) {
    NSString *root = [[NSFileManager defaultManager] currentDirectoryPath];
    NSString *outputDir = [[root stringByAppendingPathComponent:options.outputDir] stringByStandardizingPath];
    [[NSFileManager defaultManager] createDirectoryAtPath:outputDir withIntermediateDirectories:YES attributes:nil error:nil];

    PHFetchResult<PHAsset *> *assets = [PHAsset fetchAssetsInAssetCollection:album options:AssetFetchOptions(options.includeVideos)];
    NSMutableArray<NSDictionary *> *manifest = [NSMutableArray array];
    NSString *albumName = album.localizedTitle ?: @"Photos";
    NSUInteger exportCount = MIN((NSUInteger)MAX(options.limit, 0), assets.count);

    for (NSUInteger i = 0; i < exportCount; i++) {
        PHAsset *asset = [assets objectAtIndex:i];
        NSString *date = ISODate(asset.creationDate);
        NSString *assetId = Sanitize([asset.localIdentifier stringByReplacingOccurrencesOfString:@"/" withString:@"-"]);
        NSString *baseName = [NSString stringWithFormat:@"%@-%03lu-%@", date, (unsigned long)i + 1, assetId];
        NSString *mediaType = asset.mediaType == PHAssetMediaTypeVideo ? @"video" : @"photo";

        if (options.dryRun) {
            printf("%s\t%s\t%ldx%ld\t%s\n", mediaType.UTF8String, date.UTF8String, (long)asset.pixelWidth, (long)asset.pixelHeight, asset.localIdentifier.UTF8String);
            continue;
        }

        NSString *src = nil;
        NSString *thumb = nil;
        BOOL ok = asset.mediaType == PHAssetMediaTypeVideo
            ? ExportVideo(asset, baseName, outputDir, &src, &thumb)
            : ExportImage(asset, baseName, outputDir, &src, &thumb);
        if (!ok) {
            fprintf(stderr, "Skipped asset: %s\n", asset.localIdentifier.UTF8String);
            continue;
        }

        NSMutableDictionary *item = [@{
            @"id": baseName,
            @"type": mediaType,
            @"title": [NSString stringWithFormat:@"%@ %lu", albumName, (unsigned long)i + 1],
            @"album": albumName,
            @"date": date,
            @"location": @"家",
            @"description": [NSString stringWithFormat:@"从 Mac 照片 App 的「%@」相册导出的发布版素材。", albumName],
            @"tags": @[@"孩子"],
            @"src": RelativePath(root, src),
            @"thumb": RelativePath(root, thumb),
            @"width": @(MAX(asset.pixelWidth, 1)),
            @"height": @(MAX(asset.pixelHeight, 1))
        } mutableCopy];
        if (i == 0) {
            item[@"featured"] = @YES;
        }
        [manifest addObject:item];
        printf("Exported %lu/%lu: %s\n", (unsigned long)i + 1, (unsigned long)exportCount, [RelativePath(root, src) UTF8String]);
    }

    if (!options.dryRun) {
        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:manifest options:NSJSONWritingPrettyPrinted error:nil];
        [jsonData writeToFile:[outputDir stringByAppendingPathComponent:@"photos-app-manifest.json"] atomically:YES];
        printf("Exported %lu items to %s\n", (unsigned long)manifest.count, options.outputDir.UTF8String);
    }
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        Options options = ParseOptions(argc, argv);
        if (!RequestPhotosAccess()) {
            fprintf(stderr, "Photos permission denied or unavailable.\n");
            return 1;
        }
        if (options.listAlbums) {
            ListAlbums(options.includeVideos);
            return 0;
        }
        if (!options.albumName) {
            fprintf(stderr, "Missing --album.\n");
            PrintUsage();
            return 1;
        }
        PHAssetCollection *album = FindAlbum(options.albumName);
        if (!album) {
            fprintf(stderr, "Album not found: %s\n", options.albumName.UTF8String);
            return 1;
        }
        ExportAlbum(album, options);
    }
    return 0;
}
