// Impor library yang dibutuhkan
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const cors = require('cors');

// Inisialisasi aplikasi Express
const app = express();
// Railway atau platform hosting lainnya akan memberikan PORT melalui environment variable.
// Untuk development lokal, kita gunakan port 3000.
const PORT = process.env.PORT || 3000;
// PENTING: Untuk environment container seperti Railway, server harus "listen" di 0.0.0.0
// agar bisa diakses dari luar container.
const HOST = '0.0.0.0';

// Definisikan prompt untuk setiap style
const stylePrompts = {
    'ghibli': 'Ubah gambar berikut menjadi seperti style studio ghibli dengan mempertahankan detail dan original gambar.',
    'pixar': 'Ubah tekstur gambar ini agar seperti ilustrasi Pixar, tanpa mengubah bentuk atau susunan objek aslinya.',
    'simpson': 'Ubah tekstur gambar ini agar seperti ilustrasi The Simpson, tanpa mengubah bentuk atau susunan objek aslinya'
};

// Definisikan ukuran yang valid
const validSizes = ['1024x1024', '1536x1024', '1024x1536'];

// --- Middleware ---
app.use(cors()); // Mengaktifkan Cross-Origin Resource Sharing
app.use(express.json()); // Mem-parsing body request JSON
app.use(express.urlencoded({ extended: true })); // Mem-parsing body request URL-encoded

// Menyajikan file statis (seperti index.html) dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi Multer untuk menangani file upload di memori
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Batas ukuran file 10MB
});

/**
 * Fungsi untuk generate gambar.
 * PERBAIKAN KRUSIAL: Menggunakan dynamic import() untuk 'file-type'
 * karena library ini adalah ESM-only dan tidak bisa di-load dengan require() biasa.
 */
const generateArtImage = async (imageBuffer, prompt, size) => {
    if (!imageBuffer) throw new Error("Image buffer is required.");
    if (!prompt) throw new Error("Prompt is required.");
    if (!size) throw new Error("Size is required.");

    // Dynamic import untuk 'file-type'
    const { fileTypeFromBuffer } = await import('file-type');
    const fileInfo = await fileTypeFromBuffer(imageBuffer);

    if (!fileInfo) {
        throw new Error("Could not determine the file type of the uploaded image.");
    }
    const { ext, mime } = fileInfo;

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('n', '1');
    form.append('is_enhance', "true");
    form.append('image', imageBuffer, {
        filename: `image.${ext}`,
        contentType: mime,
    });

    try {
        const response = await axios.post('https://gpt1image.exomlapi.com/v1/images/generations', form, {
            headers: {
                ...form.getHeaders(),
                "Referer": "https://gpt1image.exomlapi.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"
            }
        });

        const json = response.data;
        console.log("Response from external API:", JSON.stringify(json, null, 2));

        if (!json?.data?.[0]?.url) {
            const apiMessage = json.message || 'No image URL was returned.';
            throw new Error(`Invalid response structure from external API. Message: ${apiMessage}`);
        }

        return json.data[0].url;
    } catch (error) {
        if (error.response) {
            console.error('Error from external API:', error.response.status, error.response.data);
            throw new Error(`External API request failed with status ${error.response.status}.`);
        }
        console.error('Network or other error:', error.message);
        throw error;
    }
};

// --- Endpoint Proxy untuk Gambar ---
// Endpoint ini akan menerima request untuk gambar, mengambilnya dari sumber asli,
// dan mengirimkannya ke pengguna seolah-olah berasal dari server kita.
app.get('/files/*', async (req, res) => {
    try {
        // Mengambil path gambar dari URL. req.params[0] berisi semua yang cocok dengan wildcard (*)
        const imagePath = req.params[0];
        const targetUrl = `https://anondrop.net/${imagePath}`;

        console.log(`Proxying image request for: ${targetUrl}`);

        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream' // PENTING: Minta response sebagai stream
        });

        // --- PERBAIKAN ---
        // Menetapkan header agar browser menampilkan gambar (inline) bukan mengunduh (attachment).
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        
        // Alirkan (pipe) data gambar dari sumber asli langsung ke response pengguna
        response.data.pipe(res);

    } catch (error) {
        console.error('Image proxy error:', error.message);
        res.status(500).send('Error fetching the image.');
    }
});


// --- API Endpoint untuk Generate Gambar ---
app.post('/generate', upload.single('image'), async (req, res) => {
    try {
        const { style, size } = req.body;
        const imageFile = req.file;

        if (!imageFile) {
            return res.status(400).json({ error: 'No image file was uploaded.' });
        }
        if (!style || !stylePrompts[style]) {
            return res.status(400).json({ error: 'Invalid or missing style parameter.' });
        }
        if (!size || !validSizes.includes(size)) {
            return res.status(400).json({ error: 'Invalid or missing size parameter.' });
        }

        const prompt = stylePrompts[style];
        console.log(`Image received. Style: ${style}, Size: ${size}. Forwarding to external API...`);
        
        const originalImageUrl = await generateArtImage(imageFile.buffer, prompt, size);
        console.log("Successfully generated original image URL:", originalImageUrl);

        // Mengubah URL asli menjadi URL proxy
        const urlObject = new URL(originalImageUrl);
        const proxiedImageUrl = `/files${urlObject.pathname}`; // Membuat URL relatif ke proxy kita
        
        console.log("Returning proxied URL to client:", proxiedImageUrl);

        res.status(200).json({ imageUrl: proxiedImageUrl }); // Kirim URL yang sudah ditutupi

    } catch (error) {
        console.error('Error in /generate endpoint:', error.message);
        res.status(500).json({ error: `An internal server error occurred: ${error.message}` });
    }
});

// --- Menjalankan Server ---
// Server mendengarkan di HOST dan PORT yang telah ditentukan.
app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});
