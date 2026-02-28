import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Supported code file extensions
const CODE_EXTENSIONS = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.go': 'go',
    '.rs': 'rust',
    '.php': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.json': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.sql': 'sql',
    '.sh': 'bash',
    '.vue': 'vue',
    '.dart': 'dart'
};

// Directories to ignore
const IGNORE_DIRS = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'out',
    'target',
    'bin',
    'obj',
    '.next',
    '.nuxt',
    'coverage',
    '__pycache__',
    '.pytest_cache',
    'venv',
    'env',
    '.venv',
    '.idea',
    '.vscode',
    'vendor'
];

/**
 * Process all code files in a directory
 * @param {string} dirPath - Path to directory
 * @returns {Promise<{files: Array, totalSize: number}>}
 */
export async function processCodeFiles(dirPath) {
    const files = [];
    let totalSize = 0;

    // Build glob pattern for supported extensions
    const extensions = Object.keys(CODE_EXTENSIONS).map(ext => ext.slice(1));
    const pattern = `**/*.{${extensions.join(',')}}`;

    // Find all code files
    const filePaths = await glob(pattern, {
        cwd: dirPath,
        ignore: IGNORE_DIRS.map(dir => `**/${dir}/**`),
        nodir: true,
        absolute: false
    });

    for (const filePath of filePaths) {
        const fullPath = path.join(dirPath, filePath);

        try {
            const stats = fs.statSync(fullPath);

            // Skip files larger than 1MB to avoid memory issues
            if (stats.size > 1024 * 1024) {
                continue;
            }

            const content = fs.readFileSync(fullPath, 'utf-8');

            // Skip empty files — Mongoose requires content to be non-empty
            if (!content || !content.trim()) {
                continue;
            }

            const ext = path.extname(filePath).toLowerCase();
            const language = CODE_EXTENSIONS[ext] || 'text';

            files.push({
                relativePath: filePath,
                content,
                language,
                size: stats.size
            });

            totalSize += stats.size;

        } catch (error) {
            console.error(`Error processing file ${filePath}:`, error.message);
            // Continue processing other files
        }
    }

    return { files, totalSize };
}

/**
 * Get language from file extension
 * @param {string} filename
 * @returns {string}
 */
export function getLanguageFromFilename(filename) {
    const ext = path.extname(filename).toLowerCase();
    return CODE_EXTENSIONS[ext] || 'text';
}

/**
 * Check if a file should be processed
 * @param {string} filePath
 * @returns {boolean}
 */
export function shouldProcessFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // Check if extension is supported
    if (!CODE_EXTENSIONS[ext]) {
        return false;
    }

    // Check if file is in ignored directory
    const pathParts = filePath.split(path.sep);
    for (const part of pathParts) {
        if (IGNORE_DIRS.includes(part)) {
            return false;
        }
    }

    return true;
}
