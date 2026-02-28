import OpenAI from 'openai';
import { getCodebaseFiles } from '../models/database.js';

// Lazy initialization of OpenAI client
let openaiClient = null;

function getOpenAIClient() {
    if (!openaiClient) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not set in environment variables. Please add it to your .env file.');
        }
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    return openaiClient;
}

/**
 * Answer a question about a codebase using RAG
 * @param {string} codebaseId - ID of the codebase
 * @param {string} question - User's question
 * @returns {Promise<{answer: string, fileReferences: Array}>}
 */
export async function answerQuestion(codebaseId, question) {
    try {
        // Get all files from the codebase
        const files = await getCodebaseFiles(codebaseId);

        if (files.length === 0) {
            throw new Error('No files found in codebase');
        }

        // Find relevant files using simple keyword matching
        // In a production app, you'd use vector embeddings for better retrieval
        const relevantFiles = findRelevantFiles(files, question);

        // Build context from relevant files
        const context = buildContext(relevantFiles);

        // Create prompt for GPT-4
        const prompt = createPrompt(question, context);

        // Call OpenAI API
        const openai = getOpenAIClient();
        const response = await openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            messages: [
                {
                    role: 'system',
                    content: `You are a code analysis assistant. Answer questions about codebases with precision.

When answering:
1. Provide the exact file paths where relevant code is located
2. Specify line numbers when possible (estimate based on code structure)
3. Include brief code snippets to support your answer
4. Be concise but thorough
5. ALWAYS generate a valid Mermaid.js diagram in the 'mermaidCode' field to visually represent the answer.

CRITICAL Mermaid rules — violations cause parse errors:
- Use NEWLINES (\\n) between each node/edge statement, NEVER semicolons as separators
- Edge labels with spaces MUST be in double quotes inside pipes: A -->|"Label Text"| B
- Node labels with parentheses MUST be quoted inside brackets: A["Node (detail)"]
- Keep node IDs simple alphanumeric: NodeA, ComponentB — no spaces in IDs
- Always start with: graph TD
- Example correct syntax: "graph TD\\n  A[Frontend] -->|React| B[Components]\\n  B -->|\\"Tailwind CSS\\"| C[Styles]"

Format your response as JSON with this structure:
{
  "answer": "Your detailed answer here",
  "mermaidCode": "graph TD\\n  A[Node1] --> B[Node2]\\n  B -->|\\"label\\"| C[Node3]",
  "references": [
    {
      "file": "path/to/file.js",
      "lineStart": 10,
      "lineEnd": 25,
      "snippet": "relevant code snippet",
      "explanation": "why this code is relevant"
    }
  ]
}`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            max_tokens: 4000,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);

        return {
            answer: result.answer,
            mermaidCode: result.mermaidCode,
            fileReferences: result.references || []
        };

    } catch (error) {
        console.error('Error answering question:', error);
        throw new Error(`Failed to answer question: ${error.message}`);
    }
}

/**
 * Find relevant files based on question keywords
 * @param {Array} files - All files in codebase
 * @param {string} question - User's question
 * @returns {Array} - Relevant files
 */
function findRelevantFiles(files, question) {
    const keywords = extractKeywords(question);

    const scoredFiles = files.map(file => {
        let score = 0;
        const content = file.content.toLowerCase();
        const filePath = file.file_path.toLowerCase();

        // Score based on keyword matches
        keywords.forEach(keyword => {
            const keywordLower = keyword.toLowerCase();

            // File path matches are highly relevant
            if (filePath.includes(keywordLower)) {
                score += 10;
            }

            // Content matches
            const matches = (content.match(new RegExp(keywordLower, 'g')) || []).length;
            score += matches;
        });

        return { ...file, score };
    });

    // Sort by score descending
    const sorted = scoredFiles.sort((a, b) => b.score - a.score);

    // Take top matches (score > 0). If NOTHING scores, fall back to the top 8
    // files so OpenAI always receives meaningful context.
    const matched = sorted.filter(f => f.score > 0).slice(0, 10);
    if (matched.length > 0) return matched;

    // Fallback: return up to 8 files sorted by size (larger files tend to be more important)
    return [...files]
        .sort((a, b) => (b.size || 0) - (a.size || 0))
        .slice(0, 8);
}

/**
 * Extract keywords from question
 * @param {string} question
 * @returns {Array<string>}
 */
function extractKeywords(question) {
    // Remove common words
    const stopWords = ['what', 'where', 'how', 'when', 'why', 'is', 'are', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'does', 'do'];

    const words = question
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.includes(word));

    return [...new Set(words)];
}

/**
 * Build context from relevant files
 * @param {Array} files
 * @returns {string}
 */
function buildContext(files) {
    if (files.length === 0) {
        return 'No relevant files found.';
    }

    let context = 'Relevant code files:\n\n';

    files.forEach((file, index) => {
        // Truncate very long files
        const content = file.content.length > 3000
            ? file.content.substring(0, 3000) + '\n... (truncated)'
            : file.content;

        context += `File ${index + 1}: ${file.file_path}\n`;
        context += `Language: ${file.language}\n`;
        context += '```' + file.language + '\n';
        context += content;
        context += '\n```\n\n';
    });

    return context;
}

/**
 * Create prompt for OpenAI
 * @param {string} question
 * @param {string} context
 * @returns {string}
 */
function createPrompt(question, context) {
    return `Question: ${question}

${context}

Please analyze the code and answer the question. Provide specific file paths, line ranges, and code snippets.`;
}

/**
 * Generate refactor suggestions for code
 * @param {string} code - Code snippet
 * @param {string} language - Programming language
 * @returns {Promise<Array>}
 */
export async function generateRefactorSuggestions(code, language) {
    try {
        const openai = getOpenAIClient();
        const response = await openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            messages: [
                {
                    role: 'system',
                    content: `You are a code review expert. Analyze code and provide refactoring suggestions.

Format your response as JSON with this structure:
{
  "suggestions": [
    {
      "title": "Brief title",
      "description": "Detailed explanation",
      "priority": "high|medium|low",
      "category": "performance|readability|maintainability|security|best-practices"
    }
  ]
}`
                },
                {
                    role: 'user',
                    content: `Analyze this ${language} code and provide refactoring suggestions:\n\n\`\`\`${language}\n${code}\n\`\`\``
                }
            ],
            temperature: 0.4,
            max_tokens: 1500,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);
        return result.suggestions || [];

    } catch (error) {
        console.error('Error generating refactor suggestions:', error);
        throw new Error(`Failed to generate suggestions: ${error.message}`);
    }
}
