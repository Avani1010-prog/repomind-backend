import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import { insertCodebase, insertCodeFile, updateCodebaseStats } from '../models/database.js';
import { processCodeFiles } from '../services/fileProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads');
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 // 50MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' ||
            file.mimetype === 'application/x-zip-compressed' ||
            file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'));
        }
    }
});

// Upload ZIP file endpoint
router.post('/zip', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        const codebaseId = uuidv4();
        const zipPath = req.file.path;
        const extractPath = path.join(__dirname, '../../uploads', codebaseId);

        // Extract ZIP file
        try {
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(extractPath, true);
        } catch (error) {
            fs.unlinkSync(zipPath);
            return res.status(400).json({
                success: false,
                error: 'Failed to extract ZIP file. File may be corrupted.'
            });
        }

        // Process code files
        const { files, totalSize } = await processCodeFiles(extractPath);

        // Save to database
        await insertCodebase(codebaseId, req.file.originalname, 'upload');

        for (const file of files) {
            await insertCodeFile(
                codebaseId,
                file.relativePath,
                file.content,
                file.language,
                file.size
            );
        }

        await updateCodebaseStats(codebaseId, files.length, totalSize);

        // Clean up ZIP file
        fs.unlinkSync(zipPath);

        res.json({
            success: true,
            codebaseId,
            name: req.file.originalname,
            fileCount: files.length,
            totalSize,
            message: 'Codebase uploaded successfully'
        });

    } catch (error) {
        console.error('Upload error:', error);

        // Clean up on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process upload'
        });
    }
});

// GitHub repository endpoint
router.post('/github', async (req, res) => {
    try {
        const { repoUrl } = req.body;

        if (!repoUrl) {
            return res.status(400).json({
                success: false,
                error: 'Repository URL is required'
            });
        }

        // Validate GitHub URL
        const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
        if (!githubRegex.test(repoUrl)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid GitHub repository URL'
            });
        }

        const codebaseId = uuidv4();
        const clonePath = path.join(__dirname, '../../uploads', codebaseId);

        // Clone repository
        const git = simpleGit();

        try {
            await git.clone(repoUrl, clonePath, ['--depth', '1']);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'Failed to clone repository. It may be private or not exist.'
            });
        }

        // Process code files
        const { files, totalSize } = await processCodeFiles(clonePath);

        // Extract repo name from URL
        const repoName = repoUrl.split('/').pop().replace('.git', '');

        // Save to database
        await insertCodebase(codebaseId, repoName, 'github');

        for (const file of files) {
            await insertCodeFile(
                codebaseId,
                file.relativePath,
                file.content,
                file.language,
                file.size
            );
        }

        await updateCodebaseStats(codebaseId, files.length, totalSize);

        res.json({
            success: true,
            codebaseId,
            name: repoName,
            fileCount: files.length,
            totalSize,
            message: 'GitHub repository cloned successfully'
        });

    } catch (error) {
        console.error('GitHub clone error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clone repository'
        });
    }
});

export default router;
