const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const PptxGenJS = require("pptxgenjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Whisper } = require('whisper-node');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
// app.use(express.static('public'));
app.use(express.static(path.join(__dirname, "public")));

console.log("📁 Serving static from:", path.join(__dirname, "public"));


// ตั้งค่า Multer สำหรับอัพโหลดไฟล์เสียง
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadsDir = path.join(__dirname, 'public', 'uploads', 'audio');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = `audio-${Date.now()}-${Math.random().toString(36).substring(7)}.wav`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('audio/') ||
            file.mimetype === 'video/mp4' ||
            file.mimetype === 'video/mpeg') {
            cb(null, true);
        } else {
            cb(new Error('อนุญาตเฉพาะไฟล์เสียงและวิดีโอเท่านั้น'));
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB
    }
});

// ฟังก์ชันแปลงไฟล์เสียงเป็น WAV format
function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setFfmpegPath(ffmpegPath)
            .toFormat('wav')
            .audioChannels(1)
            .audioFrequency(16000)
            .on('end', () => {
                console.log('แปลงไฟล์เสียงสำเร็จ:', outputPath);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('Error converting audio:', err);
                reject(err);
            })
            .save(outputPath);
    });
}

// API แปลงเสียงเป็นข้อความด้วย Whisper
app.post("/transcribe-audio", upload.single('audio'), async (req, res) => {
    let originalPath, wavPath;

    try {
        if (!req.file) {
            return res.status(400).json({ error: "กรุณาเลือกไฟล์เสียง" });
        }

        originalPath = req.file.path;
        wavPath = originalPath.replace(/\.[^/.]+$/, "") + '.wav';
        const language = req.body.language || 'th';

        console.log(`กำลังประมวลผลไฟล์เสียง: ${originalPath}`);

        // แปลงไฟล์เป็น WAV format
        try {
            await convertToWav(originalPath, wavPath);
        } catch (convertError) {
            console.error('Error converting audio:', convertError);
            // ถ้าแปลงไม่ได้ ให้ใช้ไฟล์เดิม
            wavPath = originalPath;
        }

        // ใช้ whisper-node สำหรับแปลงเสียงเป็นข้อความ
        console.log('กำลังโหลด Whisper model...');

        const whisper = new Whisper({
            modelName: 'base',
            autoDownload: true,
        });

        console.log('กำลังแปลงเสียงเป็นข้อความ...');

        const transcription = await whisper.transcribe(wavPath, {
            language: language,
            task: 'transcribe'
        });

        console.log('แปลงเสียงเป็นข้อความสำเร็จ');

        // ทำความสะอาดไฟล์ชั่วคราว
        try {
            if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
            if (fs.existsSync(wavPath) && wavPath !== originalPath) fs.unlinkSync(wavPath);
        } catch (cleanupError) {
            console.error('Error cleaning up files:', cleanupError);
        }

        res.json({
            success: true,
            text: transcription.text,
            language: language,
            duration: transcription.segments ? transcription.segments[transcription.segments.length - 1]?.end : 0
        });

    } catch (error) {
        console.error('Transcription error:', error);

        // ทำความสะอาดไฟล์ชั่วคราวเมื่อ error
        try {
            if (originalPath && fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
            if (wavPath && fs.existsSync(wavPath) && wavPath !== originalPath) fs.unlinkSync(wavPath);
        } catch (cleanupError) {
            console.error('Error cleaning up files:', cleanupError);
        }

        res.status(500).json({
            error: "เกิดข้อผิดพลาดในการแปลงเสียง",
            details: error.message
        });
    }
});

// API สำหรับการอัดเสียงจาก browser (Base64)
app.post("/transcribe-base64", async (req, res) => {
    try {
        const { audioData, language = 'th' } = req.body;

        if (!audioData) {
            return res.status(400).json({ error: "ไม่มีข้อมูลเสียง" });
        }

        // แปลง base64 เป็นไฟล์ชั่วคราว
        const base64Data = audioData.replace(/^data:audio\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        const tempPath = path.join(__dirname, 'temp', `recording-${Date.now()}.wav`);
        const tempDir = path.join(__dirname, 'temp');

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        fs.writeFileSync(tempPath, buffer);

        console.log('กำลังแปลงเสียงจาก base64...');

        const whisper = new Whisper({
            modelName: 'base',
            autoDownload: true,
        });

        const transcription = await whisper.transcribe(tempPath, {
            language: language,
            task: 'transcribe'
        });

        // ลบไฟล์ชั่วคราว
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (cleanupError) {
            console.error('Error cleaning up temp file:', cleanupError);
        }

        res.json({
            success: true,
            text: transcription.text,
            language: language
        });

    } catch (error) {
        console.error('Base64 transcription error:', error);
        res.status(500).json({
            error: "เกิดข้อผิดพลาดในการแปลงเสียง",
            details: error.message
        });
    }
});
// API สรุปการประชุม
app.post("/summarize", async (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "กรุณาใส่เนื้อหาการประชุม" });

    try {
        const response = await axios.post(
            "http://localhost:11434/api/generate",
            {
                model: "llama3.2",
                prompt: `
            สรุปเนื้อหาการประชุมให้อยู่ในรูปแบบย่อ เป็นภาษาไทย มีหัวข้อย่อย และ action items ที่ต้องทำต่อ :
  
            ---
            ${content}
            ---
          `,
                stream: false
            }
        );
        res.json({ summary: response.data.response.trim() });
    } catch (err) {
        console.log('Error: ', err);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการสรุปข้อมูล" });
    }
});
async function summarizeContent(content) {
    try {
        const response = await axios.post(
            "http://localhost:11434/api/generate",
            {
                model: "llama3.2",
                prompt: `
สรุปเนื้อหาการประชุมให้อยู่ในรูปแบบย่อ เป็นภาษาไทย และไม่ต้อมีบทพูดตอบโต้ฉัน เอาแนื้อหาที่สรุปมา:

---
${content}
---
`,
                stream: false
            }
        );
        // สมมติว่า API คืน text ใน response.data.output
        // console.log('Summarization response:', response);
        // console.log('Summarized content:', response.data);
        return response.data.response.trim() || "";
    } catch (error) {
        console.error("Error summarizing content:", error);
        return "";
    }
}
// function parseQuillContent(html, title, images = []) {
//     const slides = [];
//     let currentSlide = {
//         title: title,
//         content: [],
//         images: []
//     };

//     try {
//         const headingRegex = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi;
//         const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gi;
//         const listRegex = /<ul[^>]*>(.*?)<\/ul>|<ol[^>]*>(.*?)<\/ol>/gi;
//         const listItemRegex = /<li[^>]*>(.*?)<\/li>/gi;
//         const imageRegex = /<img[^>]+src="([^">]+)"[^>]*>/gi;

//         let match;
//         const headings = [];
//         while ((match = headingRegex.exec(html)) !== null) {
//             const headingText = match[1].replace(/<[^>]*>/g, '').trim();
//             if (headingText) {
//                 headings.push({
//                     type: 'heading',
//                     level: match[0].match(/<h([1-3])/)[1],
//                     text: headingText
//                 });
//             }
//         }

//         // หา paragraphs
//         const paragraphs = [];
//         while ((match = paragraphRegex.exec(html)) !== null) {
//             const text = match[1].replace(/<[^>]*>/g, '').trim();
//             if (text && text !== '<br>') paragraphs.push(text);
//         }

//         // หา lists
//         const lists = [];
//         let listMatch;
//         while ((listMatch = listRegex.exec(html)) !== null) {
//             const listContent = listMatch[1] || listMatch[2];
//             const items = [];
//             let itemMatch;
//             const itemRegex = /<li[^>]*>(.*?)<\/li>/gi;
//             while ((itemMatch = itemRegex.exec(listContent)) !== null) {
//                 const itemText = itemMatch[1].replace(/<[^>]*>/g, '').trim();
//                 if (itemText) items.push(itemText);
//             }
//             if (items.length > 0) lists.push(items);
//         }

//         // หา images ใน HTML
//         const htmlImages = [];
//         let imageMatch;
//         while ((imageMatch = imageRegex.exec(html)) !== null) {
//             htmlImages.push(imageMatch[1]);
//         }

//         // สร้างสไลด์จาก headings
//         if (headings.length > 0) {
//             headings.forEach((heading, index) => {
//                 if (index === 0) {
//                     currentSlide.title = heading.text;
//                 } else {
//                     slides.push({ ...currentSlide });
//                     currentSlide = {
//                         title: heading.text,
//                         content: [],
//                         images: []
//                     };
//                 }
//             });
//         }

//         // เพิ่ม paragraphs
//         paragraphs.forEach(paragraph => {
//             if (paragraph && paragraph.length > 0) {
//                 currentSlide.content.push({
//                     type: 'paragraph',
//                     text: paragraph
//                 });
//             }
//         });

//         // เพิ่ม lists
//         lists.forEach(list => {
//             if (list.length > 0) {
//                 currentSlide.content.push({
//                     type: 'list',
//                     items: list
//                 });
//             }
//         });

//         // เพิ่มรูปภาพ (ใช้รูปจาก images array ที่ส่งมา)
//         if (images.length > 0) {
//             currentSlide.images = images.map(img => ({
//                 type: 'image',
//                 data: img.data,
//                 name: img.name
//             }));
//         } else if (htmlImages.length > 0) {
//             // หรือใช้รูปจาก HTML ถ้ามี
//             currentSlide.images = htmlImages.map((src, index) => ({
//                 type: 'image',
//                 src: src,
//                 name: `image-${index}`
//             }));
//         }

//         // เพิ่มสไลด์สุดท้าย
//         if (currentSlide.content.length > 0 || currentSlide.title !== title || currentSlide.images.length > 0) {
//             slides.push(currentSlide);
//         }

//         // ถ้าไม่มีเนื้อหาเลย ให้สร้างสไลด์เดียว
//         if (slides.length === 0) {
//             slides.push({
//                 title: title,
//                 content: [{
//                     type: 'paragraph',
//                     text: 'เนื้อหาการนำเสนอ'
//                 }],
//                 images: []
//             });
//         }

//     } catch (error) {
//         console.error('Error parsing HTML:', error);
//         // ถ้าเกิด error ให้สร้างสไลด์พื้นฐาน
//         slides.push({
//             title: title,
//             content: [{
//                 type: 'paragraph',
//                 text: 'เนื้อหาการนำเสนอ'
//             }],
//             images: []
//         });
//     }

//     return slides;
// }

async function parseQuillContent(html, title, images = []) {
    const slides = [];
    let currentSlide = {
        title: title,
        content: [],
        images: []
    };

    let allContentText = ""; // เก็บเนื้อหาทั้งหมดเพื่อสรุป

    try {
        const headingRegex = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi;
        const paragraphRegex = /<p[^>]*>(.*?)<\/p>/gi;
        const listRegex = /<ul[^>]*>(.*?)<\/ul>|<ol[^>]*>(.*?)<\/ol>/gi;
        const imageRegex = /<img[^>]+src="([^">]+)"[^>]*>/gi;

        let match;
        const headings = [];
        while ((match = headingRegex.exec(html)) !== null) {
            const headingText = match[1].replace(/<[^>]*>/g, '').trim();
            if (headingText) {
                headings.push({
                    type: 'heading',
                    level: match[0].match(/<h([1-3])/)[1],
                    text: headingText
                });
            }
        }

        // Paragraphs
        const paragraphs = [];
        while ((match = paragraphRegex.exec(html)) !== null) {
            const text = match[1].replace(/<[^>]*>/g, '').trim();
            if (text && text !== '<br>') paragraphs.push(text);
        }

        // Lists
        const lists = [];
        let listMatch;
        while ((listMatch = listRegex.exec(html)) !== null) {
            const listContent = listMatch[1] || listMatch[2];
            const items = [];
            let itemMatch;
            const itemRegex = /<li[^>]*>(.*?)<\/li>/gi;
            while ((itemMatch = itemRegex.exec(listContent)) !== null) {
                const itemText = itemMatch[1].replace(/<[^>]*>/g, '').trim();
                if (itemText) items.push(itemText);
            }
            if (items.length > 0) lists.push(items);
        }

        // Images from HTML
        const htmlImages = [];
        let imageMatch;
        while ((imageMatch = imageRegex.exec(html)) !== null) {
            htmlImages.push(imageMatch[1]);
        }

        // สร้าง slide จาก headings
        if (headings.length > 0) {
            headings.forEach((heading, index) => {
                if (index === 0) {
                    currentSlide.title = heading.text;
                } else {
                    slides.push({ ...currentSlide });
                    currentSlide = {
                        title: heading.text,
                        content: [],
                        images: []
                    };
                }
            });
        }

        // เพิ่ม paragraphs
        paragraphs.forEach(p => {
            if (p.length > 0) {
                currentSlide.content.push({ type: 'paragraph', text: p });
                allContentText += p + "\n";
            }
        });

        // เพิ่ม lists
        lists.forEach(list => {
            if (list.length > 0) {
                currentSlide.content.push({ type: 'list', items: list });
                allContentText += list.join("\n") + "\n";
            }
        });

        // เพิ่ม images
        if (images.length > 0) {
            currentSlide.images = images.map(img => ({
                type: 'image',
                data: img.data,
                name: img.name
            }));
        } else if (htmlImages.length > 0) {
            currentSlide.images = htmlImages.map((src, index) => ({
                type: 'image',
                src: src,
                name: `image-${index}`
            }));
        }

        // เพิ่ม slide สุดท้าย
        if (currentSlide.content.length > 0 || currentSlide.title !== title || currentSlide.images.length > 0) {
            slides.push(currentSlide);
        }

        // สร้าง slide สรุปทั้งหมด
        if (allContentText.trim().length > 0) {
            // console.log('กำลังสรุปเนื้อหาทั้งหมดสำหรับสไลด์สรุป...',allContentText);
            const summaryText = await summarizeContent(allContentText);
            console.log('สรุปเนื้อหาสำเร็จ:', summaryText);
            slides.push({
                title: "สรุปเนื้อหา",
                content: [{ type: 'paragraph', text: summaryText }],
                images: []
            });
        }

        // ถ้า slides ยังว่าง
        if (slides.length === 0) {
            slides.push({
                title: title,
                content: [{ type: 'paragraph', text: 'เนื้อหาการนำเสนอ' }],
                images: []
            });
        }

    } catch (error) {
        console.error('Error parsing HTML:', error);
        slides.push({
            title: title,
            content: [{ type: 'paragraph', text: 'เนื้อหาการนำเสนอ' }],
            images: []
        });
    }

    return slides;
}
// ฟังก์ชันบันทึกรูปภาพชั่วคราว
function saveTempImage(base64Data, imageName) {
    try {
        const base64Image = base64Data.split(';base64,').pop();
        const buffer = Buffer.from(base64Image, 'base64');

        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const imagePath = path.join(tempDir, imageName);
        fs.writeFileSync(imagePath, buffer);

        return imagePath;
    } catch (error) {
        console.error('Error saving temp image:', error);
        return null;
    }
}

// API สร้าง PowerPoint จาก HTML (รองรับรูปภาพ)
app.post("/generate-pptx", async (req, res) => {
    const { title, htmlContent, template = "default", images = [] } = req.body;

    if (!title || !htmlContent) {
        return res.status(400).json({ error: "กรุณาระบุหัวข้อและเนื้อหา" });
    }

    try {
        const pptx = new PptxGenJS();

        // Template ต่างๆ
        const templates = {
            default: {
                titleBg: "2C3E50",
                titleColor: "FFFFFF",
                contentTitleColor: "2C3E50",
                contentColor: "34495E"
            },
            professional: {
                titleBg: "1A5276",
                titleColor: "FFFFFF",
                contentTitleColor: "1A5276",
                contentColor: "2C3E50"
            },
            modern: {
                titleBg: "27AE60",
                titleColor: "FFFFFF",
                contentTitleColor: "27AE60",
                contentColor: "2C3E50"
            },
            creative: {
                titleBg: "8E44AD",
                titleColor: "FFFFFF",
                contentTitleColor: "8E44AD",
                contentColor: "2C3E50"
            }
        };

        const selectedTemplate = templates[template] || templates.default;

        // ฟังก์ชันสร้างสไลด์

        function createSlide(pptx, slideData, startIndex, totalSlides) {
            let slide = pptx.addSlide();
            let slideCount = 1;
            let yPosition = 1.2;
            const maxHeight = 5.5; // ปรับให้พอดีกับข้อความ
            const imageHeight = 3;
            const imageWidth = 4;

            const addHeader = () => {
                slide.addText(slideData.title, {
                    x: 0.5,
                    y: 0.5,
                    w: 9,
                    h: 0.8,
                    fontSize: 24,
                    bold: true,
                    color: selectedTemplate.contentTitleColor,
                });
            };

            const addFooter = () => {
                slide.addText(`${startIndex + slideCount - 1}/${totalSlides}`, {
                    x: 8.5,
                    y: 6.8,
                    w: 1,
                    h: 0.4,
                    fontSize: 10,
                    color: "7F8C8D",
                    align: "right",
                });
            };

            const newSlide = () => {
                addFooter();
                slide = pptx.addSlide();
                slideCount++;
                yPosition = 1.2;
                addHeader();
            };

            addHeader();

            // แบ่งข้อความเป็นย่อหน้า
            const paragraphs = slideData.content.flatMap(item => {
                if (item.type === "paragraph") {
                    return splitTextIntoParagraphs(item.text).map(p => ({ type: "paragraph", text: p }));
                } else if (item.type === "list") {
                    return item.items.map(li => ({ type: "list", text: `• ${li}` }));
                } else {
                    return [];
                }
            });

            for (const p of paragraphs) {
                const lines = splitTextIntoLines(p.text, 90);
                for (const line of lines) {
                    if (yPosition + 0.55 > maxHeight) newSlide();
                    slide.addText(line, {
                        x: 0.7,
                        y: yPosition,
                        w: 8.5,
                        h: 0.5,
                        fontSize: 14,
                        color: selectedTemplate.contentColor,
                    });
                    yPosition += 0.55;
                }
                yPosition += 0.3; // เว้นบรรทัด
            }

            // ✅ เพิ่มรูปภาพ
            if (slideData.images && slideData.images.length > 0) {
                const imagesPerRow = 2;
                let imageX = 0.5;
                let imageY = Math.max(yPosition, maxHeight + 0.2);

                slideData.images.forEach((image, index) => {
                    if (index > 0 && index % 4 === 0) {
                        newSlide();
                        imageY = 1.2;
                        imageX = 0.5;
                    }

                    let imagePath = null;

                    if (image.data) {
                        // บันทึก base64 เป็นไฟล์ png
                        const base64Data = image.data.replace(/^data:image\/\w+;base64,/, "");
                        imagePath = path.join(__dirname, `temp-${Date.now()}-${index}.png`);
                        fs.writeFileSync(imagePath, Buffer.from(base64Data, "base64"));
                    } else if (image.src) {
                        imagePath = image.src;
                    }

                    if (imagePath) {
                        slide.addImage({
                            path: imagePath,
                            x: imageX,
                            y: imageY,
                            w: imageWidth,
                            h: imageHeight,
                        });

                        // จัดตำแหน่ง
                        if ((index + 1) % imagesPerRow === 0) {
                            imageX = 0.5;
                            imageY += imageHeight + 0.2;
                        } else {
                            imageX += imageWidth + 0.5;
                        }

                        // ลบไฟล์ชั่วคราวหลังเพิ่ม
                        if (image.data) {
                            setTimeout(() => fs.existsSync(imagePath) && fs.unlinkSync(imagePath), 3000);
                        }
                    }
                });
            }

            addFooter();
        }

        // ฟังก์ชันช่วยเหลือ
        function splitTextIntoParagraphs(text) {
            return text.split(/\n\s*\n/).map(t => t.trim()).filter(t => t.length > 0);
        }

        function splitTextIntoLines(text, maxLength) {
            const words = text.split(" ");
            const lines = [];
            let currentLine = "";
            for (const word of words) {
                if ((currentLine + word).length > maxLength) {
                    lines.push(currentLine.trim());
                    currentLine = word + " ";
                } else {
                    currentLine += word + " ";
                }
            }
            if (currentLine.trim()) lines.push(currentLine.trim());
            return lines;
        }



        // function splitTextIntoLines(text, maxLength) {
        //     const words = text.split(' ');
        //     const lines = [];
        //     let currentLine = '';

        //     words.forEach(word => {
        //         if ((currentLine + word).length > maxLength) {
        //             if (currentLine) lines.push(currentLine.trim());
        //             currentLine = word + ' ';
        //         } else {
        //             currentLine += word + ' ';
        //         }
        //     });

        //     if (currentLine) lines.push(currentLine.trim());
        //     return lines;
        // }

        // สไลด์แรก - หัวข้อหลัก
        const titleSlide = pptx.addSlide();
        titleSlide.background = { color: selectedTemplate.titleBg };
        titleSlide.addText(title, {
            x: 0.5,
            y: 2,
            w: 9,
            h: 2,
            fontSize: 36,
            bold: true,
            color: selectedTemplate.titleColor,
            align: "center"
        });
        titleSlide.addText("Created with PPTX Generator", {
            x: 0.5,
            y: 4.5,
            w: 9,
            h: 0.6,
            fontSize: 14,
            color: selectedTemplate.titleColor,
            align: "center",
            opacity: 0.7
        });

        // แปลง HTML และสร้างสไลด์เนื้อหา
        console.log('Parsing HTML content...');
        const slideStructures = await parseQuillContent(htmlContent, title, images);
        console.log(`Created ${slideStructures.length} slides from HTML`);

        // สร้างสไลด์เนื้อหา
        slideStructures.forEach((slideData, index) => {
            createSlide(
                pptx,
                slideData,
                index + 2,
                slideStructures.length + 1
            );
        });

        // สร้างไฟล์
        const fileName = `presentation-${Date.now()}.pptx`;
        const filePath = path.join(__dirname, 'public', 'downloads', fileName);

        // สร้างโฟลเดอร์ downloads ถ้ายังไม่มี
        const downloadsDir = path.join(__dirname, 'public', 'downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        await pptx.writeFile({ fileName: filePath });

        res.json({
            success: true,
            downloadUrl: `/downloads/${fileName}`,
            message: `สร้างไฟล์ PowerPoint สำเร็จ! (${pptx.slides.length} สไลด์)`,
            slideCount: pptx.slides.length
        });

    } catch (error) {
        console.error('Error generating PPTX:', error);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการสร้าง PowerPoint: " + error.message });
    }
});


// function createSlide(pptx, slideData, slideNumber, totalSlides) {
//     const slide = pptx.addSlide();

//     // หัวข้อสไลด์
//     slide.addText(slideData.title, {
//         x: 0.5,
//         y: 0.5,
//         w: 9,
//         h: 1,
//         fontSize: 24,
//         bold: true,
//         color: selectedTemplate.contentTitleColor
//     });

//     let yPosition = 1.8;
//     const maxHeight = 6.0;
//     let hasImages = false;

//     // เพิ่มเนื้อหา
//     slideData.content.forEach(item => {
//         if (yPosition < maxHeight) {
//             if (item.type === 'paragraph') {
//                 // แบ่งข้อความยาวๆ ออกเป็นบรรทัด
//                 const lines = splitTextIntoLines(item.text, 80);
//                 lines.forEach(line => {
//                     if (yPosition < maxHeight && line.trim()) {
//                         slide.addText(line, {
//                             x: 0.5,
//                             y: yPosition,
//                             w: 9,
//                             h: 0.5,
//                             fontSize: 14,
//                             color: selectedTemplate.contentColor
//                         });
//                         yPosition += 0.6;
//                     }
//                 });
//             } else if (item.type === 'list') {
//                 item.items.forEach(listItem => {
//                     if (yPosition < maxHeight && listItem.trim()) {
//                         slide.addText(`• ${listItem}`, {
//                             x: 0.5,
//                             y: yPosition,
//                             w: 9,
//                             h: 0.5,
//                             fontSize: 14,
//                             color: selectedTemplate.contentColor,
//                             bullet: true
//                         });
//                         yPosition += 0.6;
//                     }
//                 });
//             }
//         }
//     });

//     // เพิ่มรูปภาพ
//     if (slideData.images && slideData.images.length > 0) {
//         hasImages = true;
//         const imagesPerRow = 2;
//         const imageWidth = 4;
//         const imageHeight = 3;
//         let imageX = 0.5;
//         let imageY = yPosition;

//         slideData.images.forEach((image, index) => {
//             if (index < 4) { // จำกัดไม่เกิน 4 รูปต่อสไลด์
//                 try {
//                     if (image.data) {
//                         // บันทึกรูปภาพชั่วคราว
//                         const imagePath = saveTempImage(image.data, `temp-${Date.now()}-${index}.png`);
//                         if (imagePath) {
//                             slide.addImage({
//                                 path: imagePath,
//                                 x: imageX,
//                                 y: imageY,
//                                 w: imageWidth,
//                                 h: imageHeight
//                             });

//                             // ลบไฟล์ชั่วคราวหลังจากเพิ่มแล้ว
//                             setTimeout(() => {
//                                 if (fs.existsSync(imagePath)) {
//                                     fs.unlinkSync(imagePath);
//                                 }
//                             }, 1000);
//                         }
//                     } else if (image.src) {
//                         // สำหรับรูปจาก URL (ตัวอย่าง)
//                         slide.addText(`[รูปภาพ: ${image.name}]`, {
//                             x: imageX,
//                             y: imageY,
//                             w: imageWidth,
//                             h: imageHeight,
//                             fontSize: 12,
//                             color: "7F8C8D",
//                             fill: { color: "F8F9FA" },
//                             align: "center",
//                             valign: "middle"
//                         });
//                     }

//                     // จัดตำแหน่งรูปภาพ
//                     if ((index + 1) % imagesPerRow === 0) {
//                         imageX = 0.5;
//                         imageY += imageHeight + 0.2;
//                     } else {
//                         imageX += imageWidth + 0.5;
//                     }
//                 } catch (error) {
//                     console.error('Error adding image to slide:', error);
//                 }
//             }
//         });
//     }

//     // หมายเลขสไลด์
//     if (totalSlides > 1) {
//         slide.addText(`${slideNumber}/${totalSlides}`, {
//             x: 8.5,
//             y: 6.8,
//             w: 1,
//             h: 0.4,
//             fontSize: 10,
//             color: "7F8C8D",
//             align: "right"
//         });
//     }

//     return slide;
// }

// ฟังก์ชันแบ่งข้อความยาวๆ
// API อัพโหลดรูปภาพ
// app.post("/upload-image", async (req, res) => {
//     const { imageData, fileName } = req.body;

//     try {
//         const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
//         const buffer = Buffer.from(base64Data, 'base64');

//         const imageName = fileName || `image-${Date.now()}.png`;
//         const imagePath = path.join(__dirname, 'public', 'uploads', imageName);

//         const uploadsDir = path.join(__dirname, 'public', 'uploads');
//         if (!fs.existsSync(uploadsDir)) {
//             fs.mkdirSync(uploadsDir, { recursive: true });
//         }

//         fs.writeFileSync(imagePath, buffer);

//         res.json({
//             success: true,
//             imageUrl: `/uploads/${imageName}`
//         });
//     } catch (error) {
//         console.error('Error uploading image:', error);
//         res.status(500).json({ error: "เกิดข้อผิดพลาดในการอัพโหลดรูปภาพ" });
//     }
// });

// API อัพโหลดรูปภาพ
app.post("/upload-image", async (req, res) => {
    const { imageData, fileName } = req.body;

    try {
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        const imageName = fileName || `image-${Date.now()}.png`;
        const imagePath = path.join(__dirname, 'public', 'uploads', imageName);

        const uploadsDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        fs.writeFileSync(imagePath, buffer);

        res.json({
            success: true,
            imageUrl: `/uploads/${imageName}`
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการอัพโหลดรูปภาพ" });
    }
});
// API ดาวน์โหลดไฟล์
app.get("/downloads/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'public', 'downloads', filename);

    res.download(filePath, (err) => {
        if (err) {
            console.error('Download error:', err);
            res.status(404).json({ error: "ไม่พบไฟล์ที่ต้องการดาวน์โหลด" });
        }
    });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🧠 Meeting Summarizer (llama3.2) running at http://localhost:${PORT}`);
});