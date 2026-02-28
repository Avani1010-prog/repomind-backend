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

/**
 * Safe recursive directory removal — tolerates Windows locked .git files
 * @param {string} dirPath
 */
function safeRmDir(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        }
    } catch (err) {
        // Non-fatal: log but don't rethrow (Windows may lock .git handles briefly)
        console.warn(`⚠️  Could not fully remove ${dirPath}: ${err.message}`);
    }
}

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

// Split GitHub repository endpoint (frontend + backend as one codebase)
router.post('/github-split', async (req, res) => {
    const { frontendUrl, backendUrl } = req.body;

    if (!frontendUrl || !backendUrl) {
        return res.status(400).json({
            success: false,
            error: 'Both frontendUrl and backendUrl are required'
        });
    }

    const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
    if (!githubRegex.test(frontendUrl)) {
        return res.status(400).json({ success: false, error: 'Invalid frontend GitHub URL' });
    }
    if (!githubRegex.test(backendUrl)) {
        return res.status(400).json({ success: false, error: 'Invalid backend GitHub URL' });
    }

    const codebaseId = uuidv4();
    const basePath = path.join(__dirname, '../../uploads', codebaseId);
    const frontendPath = path.join(basePath, 'frontend');
    const backendPath = path.join(basePath, 'backend');

    // Ensure the base directory exists before cloning into sub-directories
    try {
        fs.mkdirSync(basePath, { recursive: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: `Could not create temp directory: ${err.message}` });
    }

    // Clone both repos in parallel using SEPARATE git instances
    // (a single simpleGit instance cannot run concurrent operations)
    try {
        await Promise.all([
            simpleGit().clone(frontendUrl, frontendPath, ['--depth', '1']).catch(err => {
                throw new Error(`Frontend clone failed: ${err.message}`);
            }),
            simpleGit().clone(backendUrl, backendPath, ['--depth', '1']).catch(err => {
                throw new Error(`Backend clone failed: ${err.message}`);
            }),
        ]);
    } catch (error) {
        console.error('GitHub split clone error:', error.message);
        safeRmDir(basePath);
        return res.status(400).json({
            success: false,
            error: error.message || 'Failed to clone one or both repositories. They may be private or not exist.'
        });
    }

    try {
        // Process each repo separately and prefix paths
        const [frontendResult, backendResult] = await Promise.all([
            processCodeFiles(frontendPath),
            processCodeFiles(backendPath),
        ]);

        const prefixedFrontend = frontendResult.files.map(f => ({
            ...f,
            relativePath: `frontend/${f.relativePath}`,
        }));
        const prefixedBackend = backendResult.files.map(f => ({
            ...f,
            relativePath: `backend/${f.relativePath}`,
        }));

        const allFiles = [...prefixedFrontend, ...prefixedBackend];
        const totalSize = frontendResult.totalSize + backendResult.totalSize;

        if (allFiles.length === 0) {
            safeRmDir(basePath);
            return res.status(400).json({
                success: false,
                error: 'No processable code files found in either repository. Make sure the repos are not empty and contain supported code files.'
            });
        }

        // Derive a combined project name from the two repo names
        const feName = frontendUrl.split('/').pop().replace('.git', '');
        const beName = backendUrl.split('/').pop().replace('.git', '');
        const combinedName = `${feName} + ${beName} (split)`;

        // Save to database
        await insertCodebase(codebaseId, combinedName, 'github-split');

        for (const file of allFiles) {
            await insertCodeFile(
                codebaseId,
                file.relativePath,
                file.content,
                file.language,
                file.size
            );
        }

        await updateCodebaseStats(codebaseId, allFiles.length, totalSize);

        res.json({
            success: true,
            codebaseId,
            name: combinedName,
            fileCount: allFiles.length,
            frontendFileCount: prefixedFrontend.length,
            backendFileCount: prefixedBackend.length,
            totalSize,
            message: 'Both repositories scanned and merged successfully',
        });

    } catch (error) {
        console.error('GitHub split processing error:', error);
        safeRmDir(basePath);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process repositories',
        });
    }
});

export default router;

