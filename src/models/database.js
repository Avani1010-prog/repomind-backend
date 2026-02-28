import mongoose from 'mongoose';

// MongoDB Connection
let isConnected = false;

export async function connectDatabase() {
  if (isConnected) {
    console.log('✅ Using existing MongoDB connection');
    return;
  }

  try {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoUri);
    isConnected = true;
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

// Codebase Schema
const codebaseSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  source: { type: String, required: true },
  file_count: { type: Number, default: 0 },
  total_size: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

// Code File Schema
const codeFileSchema = new mongoose.Schema({
  codebase_id: { type: String, required: true, index: true },
  file_path: { type: String, required: true },
  content: { type: String, required: true },
  language: { type: String },
  size: { type: Number }
});

// Question Schema
const questionSchema = new mongoose.Schema({
  codebase_id: { type: String, required: true, index: true },
  question: { type: String, required: true },
  answer: { type: String, required: true },
  file_references: { type: Array, default: [] },
  mermaid_code: { type: String },
  tags: { type: [String], default: [] },
  created_at: { type: Date, default: Date.now, index: true }
});

// Models
const Codebase = mongoose.model('Codebase', codebaseSchema);
const CodeFile = mongoose.model('CodeFile', codeFileSchema);
const Question = mongoose.model('Question', questionSchema);

// Initialize Database (for MongoDB, just connect)
export async function initDatabase() {
  await connectDatabase();
}

// Codebase Operations
export async function insertCodebase(id, name, source) {
  const codebase = new Codebase({
    _id: id,
    name,
    source
  });
  return await codebase.save();
}

export async function updateCodebaseStats(id, fileCount, totalSize) {
  return await Codebase.findByIdAndUpdate(id, {
    file_count: fileCount,
    total_size: totalSize
  });
}

export async function getCodebase(id) {
  return await Codebase.findById(id);
}

export async function getAllCodebases() {
  return await Codebase.find().sort({ created_at: -1 });
}

export async function deleteCodebase(id) {
  // Delete codebase and all related files and questions
  await CodeFile.deleteMany({ codebase_id: id });
  await Question.deleteMany({ codebase_id: id });
  return await Codebase.findByIdAndDelete(id);
}

// Code File Operations
export async function insertCodeFile(codebaseId, filePath, content, language, size) {
  // Guard: skip empty files — Mongoose `required: true` rejects empty strings
  if (!content || !content.trim()) {
    console.warn(`⚠️  Skipping empty file: ${filePath}`);
    return null;
  }

  const codeFile = new CodeFile({
    codebase_id: codebaseId,
    file_path: filePath,
    content,
    language,
    size
  });
  return await codeFile.save();
}

export async function getCodebaseFiles(codebaseId) {
  const files = await CodeFile.find({ codebase_id: codebaseId }).lean();

  // Ensure consistent field names for compatibility
  return files.map(file => ({
    id: file._id,
    codebase_id: file.codebase_id,
    file_path: file.file_path,
    content: file.content || '',
    language: file.language,
    size: file.size
  }));
}

// Question Operations
export async function insertQuestion(codebaseId, question, answer, fileReferences, mermaidCode = null) {
  const newQuestion = new Question({
    codebase_id: codebaseId,
    question,
    answer,
    file_references: fileReferences,
    mermaid_code: mermaidCode,
    tags: []
  });
  const saved = await newQuestion.save();
  return { lastInsertRowid: saved._id };
}

export async function getRecentQuestions(codebaseId, limit = 10) {
  const questions = await Question.find({ codebase_id: codebaseId })
    .sort({ created_at: -1 })
    .limit(limit);

  return questions.map(q => ({
    id: q._id,
    codebase_id: q.codebase_id,
    question: q.question,
    answer: q.answer,
    file_references: q.file_references,
    mermaid_code: q.mermaid_code,
    tags: q.tags,
    created_at: q.created_at
  }));
}

export async function addTagToQuestion(questionId, tagName) {
  return await Question.findByIdAndUpdate(
    questionId,
    { $addToSet: { tags: tagName } },
    { new: true }
  );
}

export async function deleteOldQuestions(codebaseId, keepCount = 10) {
  const questions = await Question.find({ codebase_id: codebaseId })
    .sort({ created_at: -1 })
    .skip(keepCount);

  const idsToDelete = questions.map(q => q._id);

  if (idsToDelete.length > 0) {
    return await Question.deleteMany({ _id: { $in: idsToDelete } });
  }

  return { deletedCount: 0 };
}

export async function searchQuestions(codebaseId, searchTerm) {
  const questions = await Question.find({
    codebase_id: codebaseId,
    $or: [
      { question: { $regex: searchTerm, $options: 'i' } },
      { answer: { $regex: searchTerm, $options: 'i' } }
    ]
  }).sort({ created_at: -1 });

  return questions.map(q => ({
    id: q._id,
    codebase_id: q.codebase_id,
    question: q.question,
    answer: q.answer,
    file_references: q.file_references,

    mermaid_code: q.mermaid_code,
    tags: q.tags,
    created_at: q.created_at
  }));
}

export default mongoose;
