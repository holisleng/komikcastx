import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import { URL } from "url";

const app = express();
app.use(cors());

const BASE_URL = "https://komikcast.co.id";

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

// Helper: aman ambil attr
function getAttr($el, name) {
  const v = $el.attr(name);
  return typeof v === "string" ? v.trim() : "";
}

// Helper: bersihkan URL gambar (hilangkan query tracking)
function cleanImageUrl(src) {
  if (!src) return "";
  const qIndex = src.indexOf("?");
  return qIndex > -1 ? src.slice(0, qIndex) : src;
}

// Helper: ambil segmen path dengan aman
function pathSegments(href) {
  try {
    const u = new URL(href, BASE_URL);
    return u.pathname.replace(/^\/|\/$/g, "").split("/");
  } catch {
    return [];
  }
}

// Root
app.get("/", (_req, res) => res.json({ msg: "Success" }));

// Search: /search?query=...
app.get("/search", async (req, res) => {
  const q = (req.query.query || "").toString().trim();
  if (!q) return res.status(400).json({ error: "query is required" });

  try {
    const response = await http.get(`/?s=${encodeURIComponent(q)}`);
    const $ = cheerio.load(response.data);
    const data = [];

    $(".film-list .animepost").each((_i, el) => {
      const $item = $(el);
      const title = $item
        .find(".animposx > .bigors > a > div > h4")
        .text()
        .trim();
      const href = getAttr($item.find(".animposx > a"), "href");
      const segs = pathSegments(href);
      // Expect: /komik/:slug
      const slug = segs[0] === "komik" && segs[1] ? segs[1] : "";

      if (title && slug) {
        data.push({ value: title, data: slug });
      }
    });

    return res.json(data);
  } catch (e) {
    console.error("SEARCH ERROR:", e.message);
    return res.status(500).json({ error: "Failed to fetch search results" });
  }
});

// /genre: ambil dari /manga/ semua link yang match /genres/<slug>/
app.get("/genre", async (_req, res) => {
  try {
    const response = await http.get(`/manga/`);
    const $ = cheerio.load(response.data);
    const seen = new Set();
    const data = [];

    $('a[href^="/genres/"]').each((_i, el) => {
      const href = $(el).attr("href") || "";
      const name = $(el).text().trim();

      let u;
      try {
        u = new URL(href, BASE_URL);
      } catch {
        return;
      }

      const m = u.pathname.match(/^\/genres\/([^/]+)\/?$/i);
      if (!m) return;

      const id = m[1].toLowerCase();
      if (name && id && !seen.has(id)) {
        seen.add(id);
        data.push({ nama: name, id });
      }
    });

    return res.json(data);
  } catch (e) {
    console.error("GENRE ERROR:", e.message);
    return res.status(500).json({ error: "Failed to fetch genres" });
  }
});

// List manga: /manga?page=&genre=&order=&title=
app.get("/manga", async (req, res) => {
  const page = Number(req.query.page || 1) || 1;
  const genre = (req.query.genre || "").toString();
  const order = (req.query.order || "").toString();
  const title = (req.query.title || "").toString();

  try {
    const url = `/daftar-komik/page/${page}/?genre=${encodeURIComponent(
      genre
    )}&order=${encodeURIComponent(order)}&title=${encodeURIComponent(title)}`;

    const response = await http.get(url);
    const $ = cheerio.load(response.data);
    const data = [];

    $(".arch-list .post-item").each((_i, el) => {
      const $box = $(el).find(".post-item-box > a").first();
      const imgSrc = getAttr($box.find("div > img").first(), "src");
      const judul = $box
        .find(".post-item-ttl-s .post-item-title > h4")
        .text()
        .trim();
      const score = $box
        .find(".post-item-ttl-s .post-item-additio .rating > i")
        .text()
        .trim();
      const href = getAttr($box, "href");
      const segs = pathSegments(href);
      // Expect: /komik/:slug
      const slug = segs[0] === "komik" && segs[1] ? segs[1] : "";

      if (slug && judul) {
        data.push({
          gambar: cleanImageUrl(imgSrc),
          judul,
          score,
          slug,
        });
      }
    });

    return res.json(data);
  } catch (e) {
    console.error("MANGA LIST ERROR:", e.message);
    return res.status(500).json({ error: "Failed to fetch manga list" });
  }
});

// Detail manga: /manga/:slug
app.get("/manga/:slug", async (req, res) => {
  const { slug } = req.params;
  if (!slug) return res.status(400).json({ error: "slug is required" });

  try {
    const response = await http.get(`/komik/${encodeURIComponent(slug)}/`);
    const $ = cheerio.load(response.data);

    // Chapters
    const chapters = [];
    $(".box-list-chapter > ul li").each((_i, el) => {
      const $a = $(el).find(".list-chapter-chapter > a").first();
      const href = getAttr($a, "href");
      const segs = pathSegments(href);
      // Expect: /chapter/:chapterId
      let chapterId = "";
      if (segs[0] === "chapter" && segs[1]) {
        chapterId = segs[1];
      }
      const nama = $a.text().replace(/\n/g, "").trim();
      if (chapterId && nama) chapters.push({ slug: chapterId, nama });
    });

    // Genres
    const genres = [];
    $(".genre-info-manga > a").each((_i, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });

    const gambar = cleanImageUrl(getAttr($(".thumb img").first(), "src"));
    const rawTitle = $("h1.entry-title").text().trim();
    const nama =
      rawTitle.includes("Komik") ? rawTitle.split("Komik").pop().trim() : rawTitle;

    const getInfo = (idx) => {
      const text = $(".col-info-manga-box > span").eq(idx).text() || "";
      const parts = text.split("\n").map((s) => s.trim()).filter(Boolean);
      return parts[1] || parts[0] || "";
    };

    const status = getInfo(1);
    const author = getInfo(3);
    const rilis = getInfo(5);

    const deskripsi = $(".entry-content.entry-content-single p")
      .map((_i, el) => $(el).text().trim())
      .get()
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return res.json({
      gambar,
      nama,
      status,
      author,
      rilis,
      genre: genres.join(","),
      deskripsi,
      chapters,
    });
  } catch (e) {
    console.error("MANGA DETAIL ERROR:", e.message);
    return res.sendStatus(404);
  }
});

// Gambar per halaman di chapter: /manga/:slug/:chapter
app.get("/manga/:slug/:chapter", async (req, res) => {
  const { chapter } = req.params;
  if (!chapter) return res.status(400).json({ error: "chapter is required" });

  try {
    const response = await http.get(`/chapter/${encodeURIComponent(chapter)}/`);
    const $ = cheerio.load(response.data);

    const data = [];
    const $container = $("#anjay_ini_id_kh").length
      ? $("#anjay_ini_id_kh")
      : $(".reader-area, .entry-content, .chapter-content").first();

    $container.find("img").each((_i, el) => {
      const src = cleanImageUrl(getAttr($(el), "src"));
      if (src) data.push({ gambar: src });
    });

    return res.json(data);
  } catch (e) {
    console.error("CHAPTER ERROR:", e.message);
    return res.sendStatus(404);
  }
});

// Proxy gambar: /gambar?url=https://...
// NOTE: pakai axios langsung (bukan instance baseURL)
app.get("/gambar", async (req, res) => {
  const url = (req.query.url || "").toString().trim();
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
    });

    res.setHeader(
      "Content-Type",
      response.headers?.["content-type"] || "image/jpeg"
    );
    // optional cache header biar hemat
    res.setHeader("Cache-Control", "public, max-age=86400");

    return res.send(response.data);
  } catch (e) {
    console.error("IMAGE PROXY ERROR:", e.message);
    return res.sendStatus(404);
  }
});

// ✅ penting: export default (tanpa listen)
// Vercel akan jalanin ini sebagai serverless function
export default app;
