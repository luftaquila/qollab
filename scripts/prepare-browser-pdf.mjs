// Browser PDF uses the same Pandoc filters, Typst template and font versions as
// the isolated renderer. These public assets contain no project data.
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
const root = new URL("../", import.meta.url);
const out = new URL("apps/web/public/pdf-assets/", root);
const cache = new URL("node_modules/.cache/qollab-pdf/", root);
await mkdir(out, { recursive: true });
await mkdir(cache, { recursive: true });
async function download(name, url, hash) {
  let bytes;
  try {
    bytes = await readFile(new URL(name, cache));
  } catch {}
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== hash) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`PDF asset ${name}: HTTP ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== hash)
      throw new Error(`PDF asset checksum: ${name}`);
    await writeFile(new URL(name, cache), bytes);
  }
  return bytes;
}
const pretendard = unzipSync(
  await download(
    "pretendard.zip",
    "https://github.com/orioncactus/pretendard/releases/download/v1.3.9/Pretendard-1.3.9.zip",
    "04be351a74d6bf7d60c480a3087e51d185485d35a52023142af1df19eb8c428a",
  ),
);
for (const name of ["Pretendard-Regular.ttf", "Pretendard-Bold.ttf"])
  await writeFile(
    new URL(name, out),
    pretendard["public/static/alternative/" + name],
  );
await writeFile(
  new URL("Pretendard-LICENSE.txt", out),
  pretendard["LICENSE.txt"],
);
for (const [name, url, hash] of [
  [
    "NewCMMath-Book.otf",
    "https://raw.githubusercontent.com/typst/typst-assets/v0.15.0/files/fonts/NewCMMath-Book.otf",
    "60346e6fc27773d96c3cc9d3ac8a550a85e3ca624437179bd7a88b4ca18f0a18",
  ],
  [
    "NotoSansCJKkr-Regular.otf",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf",
    "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a",
  ],
  [
    "NotoSerifCJKkr-Regular.otf",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Serif2.003/Serif/OTF/Korean/NotoSerifCJKkr-Regular.otf",
    "77b4b741f864d27f15e90f275b17106dde90b2ad28f82bab72dc95805db5fb42",
  ],
  [
    "NotoSerifCJKkr-Bold.otf",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Serif2.003/Serif/OTF/Korean/NotoSerifCJKkr-Bold.otf",
    "10cc03741178ad6d2747df8497d911e34b167d0474a826fb9d866c402cbe3d8f",
  ],
  [
    "NotoSansCJKkr-Bold.otf",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/Korean/NotoSansCJKkr-Bold.otf",
    "26d0c6748500a0444844280b308f5b62c7ae92ac6c6ac88148e502dd211eb52a",
  ],
  [
    "DejaVuSansMono.ttf",
    "https://raw.githubusercontent.com/typst/typst-assets/v0.15.0/files/fonts/DejaVuSansMono.ttf",
    "b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582",
  ],
  [
    "NotoSansMonoCJKkr-Regular.otf",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Mono/NotoSansMonoCJKkr-Regular.otf",
    "d5afed9988a28ae96afb0f4791754d3c9f4f08d08477eb1a7d6e2d905679a472",
  ],
  [
    "latinmodern-math.otf",
    "https://mirrors.ctan.org/fonts/lm-math/opentype/latinmodern-math.otf",
    "6075562b771f8b82f0c179e363389684f2dd09de30038269e2628e504bd7be0f",
  ],
  [
    "Noto-LICENSE.txt",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE",
    "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2",
  ],
  [
    "NewCM-LICENSE.txt",
    "https://tug.org/fonts/licenses/GUST-FONT-LICENSE.txt",
    "49ea6cb9257bbee0a3979c48a774cd221550ac1c20c95549efe45fc99cc18050",
  ],
  [
    "Typst-NOTICE.txt",
    "https://raw.githubusercontent.com/typst/typst-assets/v0.15.0/NOTICE",
    "80ac46fb7d70f1c30bf0c14d3408e6a6f0f9cc9997a00b592aa0d2c8a5243a9d",
  ],
])
  await writeFile(new URL(name, out), await download(name, url, hash));
for (const [source, name] of [
  ["node_modules/pandoc-wasm/src/pandoc.wasm", "pandoc.wasm"],
  ["node_modules/pandoc-wasm/LICENSE", "Pandoc-LICENSE.txt"],
  [
    "node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm",
    "typst.wasm",
  ],
])
  await copyFile(new URL(source, root), new URL(name, out));
console.log("Browser PDF engines and fonts ready");
