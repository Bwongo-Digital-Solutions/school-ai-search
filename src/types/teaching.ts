import type { JsonRecord } from './auth';

/* ----------------------------------------------------------------- curriculum ---------------- */

export interface AssessmentObjective {
  code: string;
  label: string;
  weight: number;
}

export interface PaperSection {
  label: string;
  instructions: string;
  questionCount: number;
  marksEach?: number;
  chooseN?: number;
}

export interface PaperStructure {
  label: string;
  durationMinutes: number;
  totalMarks: number;
  sections: PaperSection[];
}

export interface CurriculumFramework {
  id: string;
  label: string;
  country: string;
  academicLevel: string;
  examBody: string;
  yearLabels: string[];
  startGrade: number;
  questionTypes: string[];
  commandWords: string[];
  assessmentObjectives: AssessmentObjective[];
  paperStructures: PaperStructure[];
  marksConventions: Record<string, number>;
  gradingCountry: string;
  notes: string;
}

export interface CurriculumDocument {
  id: string;
  title: string;
  curriculum: string;
  subject: string;
  grade_level: number | null;
  academic_year: string;
  term: string;
  source_type: 'seed' | 'upload' | 'mcp';
  mime_type: string;
  uploaded_by: string;
  created_at: string;
  chunk_count: number;
  embedded_count: number;
}

/** A retrieved passage, as stored on a message or a generated artefact. */
export interface Citation {
  citationIndex: number;
  chunkId: string;
  documentId: string;
  title: string;
  heading: string;
  snippet: string;
}

/* -------------------------------------------------------------- digital examiner ------------- */

export type AssessmentType = 'quiz' | 'assignment' | 'test' | 'exam' | 'mock';
export type Difficulty = 'easy' | 'moderate' | 'challenging';
export type QuestionStatus = 'draft' | 'approved' | 'retired';

export interface TopicWeight {
  topic: string;
  weight: number;
  marks?: number;
}

export interface ExamBlueprint {
  id: string;
  name: string;
  curriculum: string;
  subject_id: string | null;
  subject_name: string;
  grade_level: number | null;
  academic_year: string;
  term: string;
  paper_label: string;
  assessment_type: AssessmentType;
  duration_minutes: number;
  total_marks: number;
  topic_weights: TopicWeight[];
  difficulty_mix: Partial<Record<Difficulty, number>>;
  bloom_mix: Record<string, number>;
  question_type_mix: Record<string, number>;
  sections: PaperSection[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MarkingSchemePoint {
  point: string;
  marks: number;
}

export interface ExamQuestion {
  id: string;
  blueprint_id: string | null;
  curriculum: string;
  subject_id: string | null;
  subject_name: string;
  grade_level: number | null;
  topic: string;
  subtopic: string;
  question_type: string;
  difficulty: Difficulty;
  bloom_level: string;
  command_word: string;
  stem: string;
  options: string[];
  correct_answer: string;
  marking_scheme: MarkingSchemePoint[];
  marks: number;
  expected_time_minutes: number;
  assessment_objective: string;
  source_references: Citation[];
  status: QuestionStatus;
  review_notes: string;
  generated_by: JsonRecord;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GeneratedPaper {
  id: string;
  blueprint_id: string | null;
  exam_id: string | null;
  title: string;
  curriculum: string;
  subject_id: string | null;
  subject_name: string;
  grade_level: number | null;
  academic_year: string;
  term: string;
  assessment_type: AssessmentType;
  duration_minutes: number;
  total_marks: number;
  instructions: string;
  question_ids: string[];
  sections: PaperSection[];
  status: 'draft' | 'published';
  published_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* ---------------------------------------------------------------- lesson planner ------------- */

export type LessonStatus = 'draft' | 'approved' | 'delivered';

export interface LessonActivity {
  stage: string;
  minutes: number;
  teacherActivity?: string;
  learnerActivity?: string;
  teacher_activity?: string;
  learner_activity?: string;
}

export interface LessonAssessment {
  method: string;
  description: string;
}

export interface LessonPlan {
  id: string;
  teacher_id: string | null;
  subject_id: string | null;
  subject_name: string;
  class_id: string | null;
  curriculum: string;
  academic_year: string;
  term: string;
  grade_level: number | null;
  topic: string;
  subtopic: string;
  title: string;
  duration_minutes: number;
  lesson_date: string | null;
  period: string;
  competencies: string[];
  learning_outcomes: string[];
  materials: string[];
  activities: LessonActivity[];
  assessment: LessonAssessment[];
  differentiation: string;
  homework: string;
  refs: Citation[];
  status: LessonStatus;
  generated_by: JsonRecord;
  created_by: string;
  created_at: string;
  updated_at: string;
}
