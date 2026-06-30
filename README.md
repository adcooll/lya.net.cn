# LYA Photo

这是给 `lya.net.cn` 准备的纯静态家庭照片/视频浏览网站。它不需要虚拟主机、云服务器、数据库或后端程序，适合部署到 Cloudflare Pages、GitHub Pages、Netlify、Vercel 等静态托管平台。

## 本地预览

直接双击 `index.html` 可以打开。更接近线上环境的方式：

```bash
python3 -m http.server 8000
```

然后访问 `http://127.0.0.1:8000/`。

## 使用 Mac 照片 App 里的孩子素材

建议先在 Mac 的“照片”App 里人工筛选，网站只读取你明确导出的发布版素材。

### 推荐流程：先建孩子相册，再自动导出

1. 在“照片”App 里打开“人物与宠物”或你已经建好的孩子相册。
2. 只选择适合公开的孩子照片或短视频，避开成年人正脸、其他孩子、校服、车牌、门牌、学校名、快递单等敏感信息。
3. 新建一个只含孩子素材的相册，例如 `LYA Kids Web`。
4. 授权本地导出工具读取 Photos 图库。
5. 导出这个相册到网站目录。

本仓库已经提供本机导出工具：

```bash
clang -fobjc-arc -framework Foundation -framework AppKit -framework Photos scripts/export_photos_objc.m -o scripts/export_photos_objc
scripts/export_photos_objc --list-albums --include-videos
scripts/export_photos_objc --album "LYA Kids Web" --limit 80 --include-videos
python3 scripts/generate_manifest.py
cp photos.generated.js photos.js
```

如果 `--list-albums` 提示 `Photos permission denied or unavailable`，到 macOS：

```text
系统设置 -> 隐私与安全性 -> 照片
```

给当前终端/Codex 相关应用允许访问照片。授权后重新运行 `scripts/export_photos_objc --list-albums --include-videos`。

导出工具会把图片重新编码成 JPEG，减少原图 EXIF/GPS 暴露风险；视频会导出原视频文件，并生成一张封面图。

### 手动导出流程

如果你不想授权自动工具，也可以在“照片”App 手动导出：

1. 选择孩子相册里的发布素材。
2. 菜单选择“文件 -> 导出 -> 导出照片/视频”。
3. 导出时尽量选择 JPEG、较高或中等质量，不要导出未经筛选的原始文件。
4. 把发布版文件放到 `media/public/`，例如：

```text
media/public/
  growth/
    park-play.jpg
    reading.jpg
  videos/
    birthday.mp4
    birthday.jpg
```

视频如果有同名封面图，例如 `birthday.mp4` 和 `birthday.jpg`，网站会把 JPG 当作视频封面，不会重复显示成一张照片。

然后生成素材清单：

```bash
python3 scripts/generate_manifest.py
cp photos.generated.js photos.js
```

刷新页面即可看到 `media/public/` 里的素材。

`media/private-originals/` 是给你临时放原始素材的本地目录，已经加入 `.gitignore`，不要部署这个目录里的内容。

## 手动编辑素材清单

编辑 `photos.js` 里的 `window.PHOTO_SITE.photos`：

- `type`：`photo` 或 `video`。
- `src`：照片或视频地址，可以是 `media/public/xxx.jpg`、`media/public/xxx.mp4`，也可以是对象存储/CDN 地址。
- `thumb`：缩略图或视频封面地址，建议宽度 800-1000px；视频没有封面时可以留空。
- `width`、`height`：照片比例，不必是实际像素，只要比例正确即可。
- `album`、`date`、`location`、`tags`：用于筛选和搜索。

照片文件尽量压缩到单张 500KB-2MB；公开视频建议压到 720p 或 1080p 的 MP4。文件过大会拖慢浏览，也更费流量。

## 儿歌音乐

网站支持播放你放在 `media/audio/` 里的本地 MP3。默认配置在 `music.js`：

```js
window.LYA_MUSIC = {
  intro: "贝乐虎儿歌",
  autoplay: true,
  tracks: [
    { title: "贝乐虎儿歌 01", src: "media/audio/belehu-01.mp3" }
  ]
};
```

把已购买、获得授权或确认可公开使用的贝乐虎儿歌 MP3 放到 `media/audio/`，再按实际文件名修改 `music.js`。不要把未授权的贝乐虎、迪士尼、汪汪队等版权音乐上传到公开网站。

浏览器通常会拦截“未点击页面就自动播放有声音乐”。网站已经会自动尝试播放；如果浏览器拦截，会在播放器里提示“点一下播放儿歌”，用户点击播放按钮后就会继续循环播放。

## 缓存更新策略

网站已经做了两层处理，避免云上图片缓存太久：

- `photos.js` 里有 `version` 字段，页面会自动给照片、视频和音频 URL 加 `?v=版本号`。
- `_headers` 里设置 `index.html`、`photos.js`、`music.js` 不强缓存，图片和音频可以长缓存。

每次替换照片后，推荐重新生成清单：

```bash
python3 scripts/generate_manifest.py
cp photos.generated.js photos.js
```

生成脚本会自动写入新的 `version`。如果手动编辑 `photos.js`，只要把顶部的 `"version"` 改成新的值，例如 `"2026061902"`，线上图片链接就会变，CDN/浏览器会重新拉取新图。

## 推荐部署方案

这个网站是纯静态站，不需要云服务器、数据库或虚拟主机。性价比最高的方式通常是：

1. 网站页面放 Cloudflare Pages 或 GitHub Pages。
2. 照片数量不大时直接放在本仓库 `media/public/`。
3. 照片/视频越来越多时，再把大文件迁到对象存储，例如 Cloudflare R2、Backblaze B2、阿里云 OSS 或腾讯云 COS。

如果你主要面向中国大陆访问，使用阿里云/腾讯云 OSS + CDN 速度更稳，但中国大陆接入通常需要 ICP 备案。如果你希望先低成本上线，优先选 Cloudflare Pages 或 GitHub Pages。

### 当前推荐路线

如果只是个人照片浏览站，先不要买云服务器，也不需要传统虚拟主机。推荐：

1. 先用 Cloudflare Pages 部署整个静态站，成本最低，维护最少。
2. `lya.net.cn` 接入 Cloudflare DNS，然后在 Pages 里绑定自定义域名。
3. 当前 21 张照片可以直接放在 `media/public/`。
4. 以后照片/视频超过几百 MB，再把媒体迁到对象存储。
5. 如果发现国内访问 Cloudflare 速度不稳定，再考虑阿里云 OSS + CDN，并同步办理 ICP 备案。

需要准备：

- 域名 `lya.net.cn` 的 DNS 管理权限。
- 一个 Cloudflare 账号。
- 本网站目录里的全部文件。
- 如果要播放贝乐虎儿歌，需要准备已授权 MP3 文件并放到 `media/audio/`。
- 上线前检查所有照片不包含成人正脸、其他孩子、学校/住址/车牌等敏感信息。

### 方案 A：Cloudflare Pages

适合你现在“只有域名、没有服务器”的情况。可以直接拖拽上传整个文件夹，也可以连接 Git 仓库自动部署。

1. 登录 Cloudflare。
2. 进入 Workers & Pages。
3. 选择 Pages，新建项目。
4. 选择 Direct Upload 时，把这个目录拖进去。
5. 部署成功后，在 Custom domains 里添加 `lya.net.cn`。
6. 如果把根域名 `lya.net.cn` 接到 Cloudflare Pages，通常需要把域名 DNS 托管切到 Cloudflare；如果只用 `www.lya.net.cn`，可以添加 CNAME 到 `<项目名>.pages.dev`。

官方参考：

- Cloudflare Pages Direct Upload：<https://developers.cloudflare.com/pages/get-started/direct-upload/>
- Cloudflare Pages Custom domains：<https://developers.cloudflare.com/pages/configuration/custom-domains/>

### 方案 B：GitHub Pages

适合希望用 Git 管理网站历史版本的人。

1. 建一个 GitHub 仓库。
2. 上传这些文件。
3. Settings -> Pages，选择发布分支。
4. Custom domain 填 `lya.net.cn`。
5. 域名 DNS 添加 GitHub Pages 要求的 A/AAAA 记录；`www` 可用 CNAME 指向 `<用户名>.github.io`。

仓库根目录里的 `CNAME` 文件已经写入 `lya.net.cn`，这是 GitHub Pages 识别自定义域名常用的配置。

官方参考：<https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site>

## 备案提醒

如果网站接入中国大陆境内服务器或大陆 CDN，个人网站通常需要进行 ICP 备案。若部署在境外静态托管平台，一般不走大陆接入商备案流程，但国内访问速度和稳定性可能受网络环境影响。

孩子照片/视频上线前建议逐张检查：

- 不放原图，先压缩、裁剪、去除 EXIF/GPS。
- 不出现成年人正脸，除非已经获得同意。
- 不出现其他孩子正脸，除非其监护人同意。
- 不出现学校、班级、住址、门牌、车牌、证件、快递单。
- 不写精确拍摄地点和日常固定行程。
- 真正私密的家庭相册不要做成公开静态站，可考虑 Cloudflare Access 之类的访问控制。

备案入口参考：<https://beian.miit.gov.cn/>

## 后续可增强

- 用 Cloudflare R2、Backblaze B2 或阿里云 OSS 单独存照片/视频，网页仍然静态部署。
- 给照片生成缩略图和 WebP/AVIF 版本，提高加载速度。
- 添加私密相册：静态站本身没有登录系统，真正需要保护时建议用 Cloudflare Access 或受控对象存储。
- 加入 EXIF 信息展示，但上线前建议移除 GPS 坐标等敏感元数据。
