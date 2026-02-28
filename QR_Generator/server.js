const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const QRCode = require("qrcode");
const multer = require("multer");
const Jimp = require("jimp");
const jsQR = require("jsqr");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: "Too many requests. Try again after 15 minutes." },
}));

// Multer for file uploads (QR decode)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
  },
});

// ── Helpers ──
const ok  = (res, data, meta = {}) => res.json({ success: true, ...meta, data });
const err = (res, status, message) => res.status(status).json({ success: false, error: message });

// QR options builder
const buildQROptions = (query = {}) => {
  const {
    size = 300,
    margin = 2,
    color = "000000",
    bg_color = "ffffff",
    error_correction = "M",
    format = "png",
  } = query;

  const validEC = ["L", "M", "Q", "H"];
  const validFormats = ["png", "svg", "base64"];

  return {
    width: Math.min(Math.max(parseInt(size) || 300, 100), 2000),
    margin: Math.min(Math.max(parseInt(margin) || 2, 0), 10),
    color: {
      dark: `#${color.replace("#", "")}`,
      light: `#${bg_color.replace("#", "")}`,
    },
    errorCorrectionLevel: validEC.includes(error_correction?.toUpperCase())
      ? error_correction.toUpperCase()
      : "M",
    format: validFormats.includes(format?.toLowerCase()) ? format.toLowerCase() : "png",
  };
};

// Send QR response based on format
const sendQR = async (res, data, opts, meta = {}) => {
  if (opts.format === "svg") {
    const svg = await QRCode.toString(data, { ...opts, type: "svg" });
    return res.json({ success: true, ...meta, data: { format: "svg", qr: svg } });
  }
  // PNG or base64
  const base64 = await QRCode.toDataURL(data, { ...opts, type: "image/png" });
  if (opts.format === "png") {
    const buffer = Buffer.from(base64.split(",")[1], "base64");
    return res.json({
      success: true,
      ...meta,
      data: {
        format: "png",
        base64: base64,
        image_url_ready: base64, // ready to use in <img src="">
        size_px: opts.width,
      },
    });
  }
  return res.json({ success: true, ...meta, data: { format: "base64", qr: base64 } });
};

// ══════════════════════════════════════════════
//  DOCS
// ══════════════════════════════════════════════
app.get("/", (req, res) => {
  res.json({
    name: "QR Code Generator & Decoder API",
    version: "1.0.0",
    description: "Generate QR codes for URLs, text, WiFi, vCard, email, SMS, UPI & more. Decode QR from images.",
    endpoints: {
      // ── GENERATE ──
      "GET  /qr/url"          : "URL QR code | ?url=https://example.com",
      "GET  /qr/text"         : "Plain text QR | ?text=Hello+World",
      "GET  /qr/email"        : "Email QR | ?to=user@mail.com &subject=Hi &body=Message",
      "GET  /qr/sms"          : "SMS QR | ?phone=+919876543210 &message=Hello",
      "GET  /qr/phone"        : "Phone call QR | ?phone=+919876543210",
      "GET  /qr/wifi"         : "WiFi QR | ?ssid=MyNetwork &password=mypass &encryption=WPA",
      "GET  /qr/vcard"        : "Contact/vCard QR | ?name= &phone= &email= &org= &url=",
      "GET  /qr/upi"          : "UPI Payment QR | ?vpa=user@upi &name=Name &amount=100",
      "GET  /qr/location"     : "GPS Location QR | ?lat=28.6139 &lng=77.2090",
      "GET  /qr/whatsapp"     : "WhatsApp message QR | ?phone=+91... &message=Hello",
      "GET  /qr/event"        : "Calendar event QR | ?title= &start= &end= &location= &desc=",
      "POST /qr/bulk"         : "Bulk generate up to 50 QRs | body: { items: [{type, data}] }",
      // ── DECODE ──
      "POST /qr/decode"       : "Decode QR from image upload | multipart: file=image",
      "POST /qr/decode/base64": "Decode QR from base64 image | body: { image: base64string }",
    },
    common_query_params: {
      size:             "QR size in pixels (100–2000, default 300)",
      margin:           "Quiet zone border (0–10, default 2)",
      color:            "QR dot color hex without # (default 000000)",
      bg_color:         "Background color hex without # (default ffffff)",
      error_correction: "Error correction level: L, M, Q, H (default M)",
      format:           "Output format: png | svg | base64 (default png)",
    },
    error_correction_guide: {
      L: "~7% data recovery — smallest QR",
      M: "~15% data recovery — balanced (default)",
      Q: "~25% data recovery — better for logos",
      H: "~30% data recovery — best for printed QRs",
    },
    example_requests: {
      url_qr:       "/qr/url?url=https://google.com&size=400&color=1a1a2e",
      wifi_qr:      "/qr/wifi?ssid=HomeNetwork&password=mypass123&encryption=WPA",
      vcard_qr:     "/qr/vcard?name=Rahul+Sharma&phone=+919876543210&email=rahul@gmail.com&org=TechCorp",
      upi_qr:       "/qr/upi?vpa=rahul@okicici&name=Rahul+Sharma&amount=499",
      whatsapp_qr:  "/qr/whatsapp?phone=+919876543210&message=Hello+from+API",
      bulk_qr: {
        method: "POST", url: "/qr/bulk",
        body: { items: [{ type: "url", data: { url: "https://google.com" } }, { type: "text", data: { text: "Hello World" } }] }
      },
    },
  });
});

// ══════════════════════════════════════════════
//  1. URL QR
// ══════════════════════════════════════════════
app.get("/qr/url", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return err(res, 400, "url param required. Example: ?url=https://example.com");
    if (!url.startsWith("http://") && !url.startsWith("https://"))
      return err(res, 400, "URL must start with http:// or https://");

    const opts = buildQROptions(req.query);
    await sendQR(res, url, opts, {
      type: "url",
      input: { url },
      qr_options: { size: opts.width, format: opts.format, error_correction: opts.errorCorrectionLevel },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  2. TEXT QR
// ══════════════════════════════════════════════
app.get("/qr/text", async (req, res) => {
  try {
    const { text } = req.query;
    if (!text || text.trim().length === 0)
      return err(res, 400, "text param required. Example: ?text=Hello+World");
    if (text.length > 2000)
      return err(res, 400, "Text too long. Max 2000 characters.");

    const opts = buildQROptions(req.query);
    await sendQR(res, text, opts, {
      type: "text",
      input: { text, char_count: text.length },
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  3. EMAIL QR
// ══════════════════════════════════════════════
app.get("/qr/email", async (req, res) => {
  try {
    const { to, subject = "", body = "" } = req.query;
    if (!to) return err(res, 400, "to param required. Example: ?to=user@example.com");
    if (!to.includes("@")) return err(res, 400, "Invalid email address in 'to'");

    let mailto = `mailto:${to}`;
    const params = [];
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    if (params.length) mailto += `?${params.join("&")}`;

    const opts = buildQROptions(req.query);
    await sendQR(res, mailto, opts, {
      type: "email",
      input: { to, subject, body },
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  4. SMS QR
// ══════════════════════════════════════════════
app.get("/qr/sms", async (req, res) => {
  try {
    const { phone, message = "" } = req.query;
    if (!phone) return err(res, 400, "phone param required. Example: ?phone=+919876543210");

    const smsData = message
      ? `sms:${phone}?body=${encodeURIComponent(message)}`
      : `sms:${phone}`;

    const opts = buildQROptions(req.query);
    await sendQR(res, smsData, opts, {
      type: "sms",
      input: { phone, message },
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  5. PHONE CALL QR
// ══════════════════════════════════════════════
app.get("/qr/phone", async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return err(res, 400, "phone param required. Example: ?phone=+919876543210");

    const opts = buildQROptions(req.query);
    await sendQR(res, `tel:${phone}`, opts, {
      type: "phone",
      input: { phone },
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  6. WIFI QR
// ══════════════════════════════════════════════
app.get("/qr/wifi", async (req, res) => {
  try {
    const { ssid, password = "", encryption = "WPA", hidden = "false" } = req.query;
    if (!ssid) return err(res, 400, "ssid param required. Example: ?ssid=MyNetwork&password=mypass");

    const validEnc = ["WPA", "WEP", "nopass"];
    const enc = validEnc.includes(encryption.toUpperCase())
      ? encryption.toUpperCase()
      : "WPA";

    // Standard WiFi QR format
    const wifiData = `WIFI:T:${enc};S:${ssid};P:${password};H:${hidden === "true"};`;

    const opts = buildQROptions(req.query);
    await sendQR(res, wifiData, opts, {
      type: "wifi",
      input: { ssid, encryption: enc, hidden: hidden === "true", password_set: password.length > 0 },
      info: "Scan with phone camera to connect automatically",
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  7. VCARD QR (Contact Card)
// ══════════════════════════════════════════════
app.get("/qr/vcard", async (req, res) => {
  try {
    const {
      name, phone = "", email = "", org = "",
      title = "", url = "", address = "", note = ""
    } = req.query;

    if (!name) return err(res, 400, "name param required. Example: ?name=Rahul+Sharma&phone=+919876543210");

    // Build vCard 3.0 format
    let vcard = `BEGIN:VCARD\nVERSION:3.0\n`;
    vcard += `FN:${name}\n`;
    vcard += `N:${name.split(" ").reverse().join(";")};;\n`;
    if (phone)   vcard += `TEL;TYPE=CELL:${phone}\n`;
    if (email)   vcard += `EMAIL:${email}\n`;
    if (org)     vcard += `ORG:${org}\n`;
    if (title)   vcard += `TITLE:${title}\n`;
    if (url)     vcard += `URL:${url}\n`;
    if (address) vcard += `ADR:;;${address};;;;\n`;
    if (note)    vcard += `NOTE:${note}\n`;
    vcard += `END:VCARD`;

    const opts = buildQROptions({ ...req.query, error_correction: "H" }); // H for vCard — more data
    await sendQR(res, vcard, opts, {
      type: "vcard",
      input: { name, phone, email, org, title, url },
      info: "Scan to add contact directly to phone",
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  8. UPI PAYMENT QR 🇮🇳
// ══════════════════════════════════════════════
app.get("/qr/upi", async (req, res) => {
  try {
    const { vpa, name = "", amount = "", currency = "INR", note = "" } = req.query;
    if (!vpa) return err(res, 400, "vpa param required. Example: ?vpa=rahul@okicici&name=Rahul&amount=100");
    if (!vpa.includes("@")) return err(res, 400, "Invalid UPI VPA. Must contain @ (e.g. user@okicici)");

    let upiData = `upi://pay?pa=${vpa}`;
    if (name)     upiData += `&pn=${encodeURIComponent(name)}`;
    if (amount)   upiData += `&am=${amount}`;
    if (currency) upiData += `&cu=${currency}`;
    if (note)     upiData += `&tn=${encodeURIComponent(note)}`;

    const opts = buildQROptions(req.query);
    await sendQR(res, upiData, opts, {
      type: "upi",
      input: { vpa, name, amount: amount || "any", currency, note },
      info: "Scan with any UPI app (GPay, PhonePe, Paytm, etc.)",
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  9. LOCATION / GPS QR
// ══════════════════════════════════════════════
app.get("/qr/location", async (req, res) => {
  try {
    const { lat, lng, label = "" } = req.query;
    if (!lat || !lng) return err(res, 400, "lat and lng required. Example: ?lat=28.6139&lng=77.2090");

    const latNum = parseFloat(lat), lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) return err(res, 400, "lat and lng must be valid numbers");
    if (latNum < -90 || latNum > 90) return err(res, 400, "lat must be between -90 and 90");
    if (lngNum < -180 || lngNum > 180) return err(res, 400, "lng must be between -180 and 180");

    // Works with Google Maps, Apple Maps etc
    const geoData = label
      ? `https://maps.google.com?q=${latNum},${lngNum}&label=${encodeURIComponent(label)}`
      : `geo:${latNum},${lngNum}`;

    const opts = buildQROptions(req.query);
    await sendQR(res, geoData, opts, {
      type: "location",
      input: { latitude: latNum, longitude: lngNum, label },
      info: "Scan to open location in maps app",
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  10. WHATSAPP QR
// ══════════════════════════════════════════════
app.get("/qr/whatsapp", async (req, res) => {
  try {
    const { phone, message = "" } = req.query;
    if (!phone) return err(res, 400, "phone required. Example: ?phone=+919876543210&message=Hello");

    const cleanPhone = phone.replace(/[^0-9]/g, "");
    const waUrl = message
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/${cleanPhone}`;

    const opts = buildQROptions(req.query);
    await sendQR(res, waUrl, opts, {
      type: "whatsapp",
      input: { phone: `+${cleanPhone}`, message },
      info: "Scan to open WhatsApp chat directly",
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  11. CALENDAR EVENT QR
// ══════════════════════════════════════════════
app.get("/qr/event", async (req, res) => {
  try {
    const { title, start, end, location = "", description = "" } = req.query;
    if (!title || !start) return err(res, 400, "title and start required. Example: ?title=Meeting&start=20240115T100000&end=20240115T110000");

    // iCalendar format
    let vevent = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\n`;
    vevent += `SUMMARY:${title}\n`;
    vevent += `DTSTART:${start}\n`;
    if (end) vevent += `DTEND:${end}\n`;
    if (location) vevent += `LOCATION:${location}\n`;
    if (description) vevent += `DESCRIPTION:${description}\n`;
    vevent += `END:VEVENT\nEND:VCALENDAR`;

    const opts = buildQROptions(req.query);
    await sendQR(res, vevent, opts, {
      type: "calendar_event",
      input: { title, start, end, location, description },
      info: "Scan to add event to calendar",
      format_tip: "start/end format: YYYYMMDDTHHMMSS (e.g. 20240115T140000)",
      qr_options: { size: opts.width, format: opts.format },
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  12. BULK GENERATE QR
// ══════════════════════════════════════════════
app.post("/qr/bulk", async (req, res) => {
  try {
    const { items, size = 200, format = "png", error_correction = "M" } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0)
      return err(res, 400, 'Provide items array. Example: { "items": [{ "type": "url", "data": { "url": "https://google.com" } }] }');
    if (items.length > 50)
      return err(res, 400, "Maximum 50 QR codes per bulk request.");

    const validTypes = ["url", "text", "email", "sms", "phone", "wifi", "vcard", "upi", "whatsapp", "location"];
    const opts = buildQROptions({ size, format, error_correction });
    const results = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!validTypes.includes(item.type)) {
        results.push({ index: i, success: false, error: `Invalid type "${item.type}". Valid: ${validTypes.join(", ")}` });
        continue;
      }

      try {
        let qrData = "";

        switch (item.type) {
          case "url":      qrData = item.data.url; break;
          case "text":     qrData = item.data.text; break;
          case "email":    qrData = `mailto:${item.data.to}${item.data.subject ? `?subject=${encodeURIComponent(item.data.subject)}` : ""}`; break;
          case "sms":      qrData = `sms:${item.data.phone}${item.data.message ? `?body=${encodeURIComponent(item.data.message)}` : ""}`; break;
          case "phone":    qrData = `tel:${item.data.phone}`; break;
          case "whatsapp": qrData = `https://wa.me/${item.data.phone.replace(/[^0-9]/g, "")}${item.data.message ? `?text=${encodeURIComponent(item.data.message)}` : ""}`; break;
          case "location": qrData = `geo:${item.data.lat},${item.data.lng}`; break;
          case "upi":      qrData = `upi://pay?pa=${item.data.vpa}${item.data.name ? `&pn=${encodeURIComponent(item.data.name)}` : ""}${item.data.amount ? `&am=${item.data.amount}&cu=INR` : ""}`; break;
          case "wifi":     qrData = `WIFI:T:${item.data.encryption || "WPA"};S:${item.data.ssid};P:${item.data.password || ""};H:false;`; break;
          case "vcard": {
            const d = item.data;
            qrData = `BEGIN:VCARD\nVERSION:3.0\nFN:${d.name}\n${d.phone ? `TEL;TYPE=CELL:${d.phone}\n` : ""}${d.email ? `EMAIL:${d.email}\n` : ""}${d.org ? `ORG:${d.org}\n` : ""}END:VCARD`;
            break;
          }
        }

        if (!qrData) throw new Error("Could not build QR data from provided fields");

        const base64 = await QRCode.toDataURL(qrData, { ...opts, type: "image/png" });
        results.push({ index: i, success: true, type: item.type, qr: base64 });
      } catch (itemErr) {
        results.push({ index: i, success: false, type: item.type, error: itemErr.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    ok(res, results, {
      total: items.length,
      success_count: successCount,
      failed_count: items.length - successCount,
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ══════════════════════════════════════════════
//  13. DECODE QR — File Upload
// ══════════════════════════════════════════════
app.post("/qr/decode", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return err(res, 400, 'No image file provided. Send image as multipart form-data with key "file"');

    const image = await Jimp.read(req.file.buffer);
    const { data, width, height } = image.bitmap;

    const code = jsQR(new Uint8ClampedArray(data), width, height);

    if (!code) {
      return err(res, 422, "No QR code found in the image. Make sure the image is clear and contains a QR code.");
    }

    ok(res, {
      decoded_text: code.data,
      qr_location: {
        top_left:     code.location.topLeftCorner,
        top_right:    code.location.topRightCorner,
        bottom_left:  code.location.bottomLeftCorner,
        bottom_right: code.location.bottomRightCorner,
      },
      image_info: {
        width_px: width,
        height_px: height,
        file_size_kb: (req.file.size / 1024).toFixed(1),
        mime_type: req.file.mimetype,
      },
    }, { method: "file_upload" });
  } catch (e) {
    err(res, 500, `Decode failed: ${e.message}`);
  }
});

// ══════════════════════════════════════════════
//  14. DECODE QR — Base64 Image
// ══════════════════════════════════════════════
app.post("/qr/decode/base64", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return err(res, 400, 'Provide image as base64 string in body: { "image": "data:image/png;base64,..." }');

    const base64Data = image.includes(",") ? image.split(",")[1] : image;
    const buffer = Buffer.from(base64Data, "base64");

    const img = await Jimp.read(buffer);
    const { data, width, height } = img.bitmap;
    const code = jsQR(new Uint8ClampedArray(data), width, height);

    if (!code) {
      return err(res, 422, "No QR code found in the image.");
    }

    ok(res, {
      decoded_text: code.data,
      qr_location: {
        top_left:     code.location.topLeftCorner,
        top_right:    code.location.topRightCorner,
        bottom_left:  code.location.bottomLeftCorner,
        bottom_right: code.location.bottomRightCorner,
      },
      image_info: { width_px: width, height_px: height },
    }, { method: "base64" });
  } catch (e) {
    err(res, 500, `Decode failed: ${e.message}`);
  }
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found.`,
    help: "Visit GET / for full documentation",
  });
});

// ── Error Handler ──
app.use((error, req, res, next) => {
  if (error.message === "Only image files allowed")
    return err(res, 400, "Only image files are allowed (jpg, png, gif, webp)");
  if (error.code === "LIMIT_FILE_SIZE")
    return err(res, 400, "File too large. Maximum 5MB allowed.");
  err(res, 500, error.message || "Something went wrong");
});

app.listen(PORT, () => {
  console.log(`\n⬛  QR Code Generator & Decoder API`);
  console.log(`🚀  Running at  http://localhost:${PORT}`);
  console.log(`📖  Docs at     http://localhost:${PORT}/`);
  console.log(`\n📋  Endpoints:`);
  console.log(`    GET  /qr/url        → URL QR`);
  console.log(`    GET  /qr/text       → Text QR`);
  console.log(`    GET  /qr/email      → Email QR`);
  console.log(`    GET  /qr/sms        → SMS QR`);
  console.log(`    GET  /qr/phone      → Phone Call QR`);
  console.log(`    GET  /qr/wifi       → WiFi QR`);
  console.log(`    GET  /qr/vcard      → Contact vCard QR`);
  console.log(`    GET  /qr/upi        → UPI Payment QR`);
  console.log(`    GET  /qr/location   → GPS Location QR`);
  console.log(`    GET  /qr/whatsapp   → WhatsApp QR`);
  console.log(`    GET  /qr/event      → Calendar Event QR`);
  console.log(`    POST /qr/bulk       → Bulk Generate (up to 50)`);
  console.log(`    POST /qr/decode     → Decode QR from image`);
  console.log(`    POST /qr/decode/base64 → Decode QR from base64\n`);
});
