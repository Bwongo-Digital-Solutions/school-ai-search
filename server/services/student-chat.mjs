const formatStudentTable = (students) => {
  const header = '| Student | Grade | Section | GPA | Attendance | Status |';
  const divider = '| --- | --- | --- | --- | --- | --- |';
  const rows = students.map(
    (student) =>
      `| ${student.first_name} ${student.last_name} | ${student.grade_level} | ${student.class_section} | ${Number(student.gpa).toFixed(2)} | ${Number(student.attendance_rate).toFixed(1)}% | ${student.status} |`,
  );

  return [header, divider, ...rows].join('\n');
};

const formatStudentProfile = (student) =>
  [
    `## ${student.first_name} ${student.last_name}`,
    '',
    `- Student ID: \`${student.student_id}\``,
    `- Grade: ${student.grade_level}-${student.class_section}`,
    `- Status: ${student.status}`,
    `- GPA: ${Number(student.gpa).toFixed(2)}`,
    `- Attendance: ${Number(student.attendance_rate).toFixed(1)}%`,
    `- Subjects: ${student.subjects.join(', ')}`,
    `- Parent / Guardian: ${student.parent_name || 'Not provided'}`,
    student.notes ? `- Notes: ${student.notes}` : '- Notes: None',
  ].join('\n');

const extractNumber = (text, fallback) => {
  const match = text.match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : fallback;
};

const findStudentMatches = (students, query) => {
  const normalized = query.toLowerCase();
  const exactMatches = students.filter(
    (student) =>
      normalized.includes(`${student.first_name} ${student.last_name}`.toLowerCase()) ||
      normalized.includes(student.student_id.toLowerCase()),
  );

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const nameTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return students.filter((student) => {
    const first = student.first_name.toLowerCase();
    const last = student.last_name.toLowerCase();
    return nameTokens.includes(first) && nameTokens.includes(last);
  });
};

export const generateAssistantReply = ({ message, students, hasImage }) => {
  const trimmed = (message || '').trim();
  const normalized = trimmed.toLowerCase();

  if (!trimmed && hasImage) {
    return {
      message: [
        'I received the attachment.',
        '',
        'Local mode stores the upload with the conversation, but image OCR is still a placeholder.',
        'You can still generate formal PDF report cards directly from the Student Management view.',
      ].join('\n'),
      studentsFound: 0,
    };
  }

  const nameMatches = findStudentMatches(students, normalized);
  if (nameMatches.length === 1) {
    return {
      message: formatStudentProfile(nameMatches[0]),
      studentsFound: 1,
    };
  }

  if (normalized.includes('top') && normalized.includes('gpa')) {
    const limit = extractNumber(normalized, 5);
    const topStudents = [...students].sort((left, right) => right.gpa - left.gpa).slice(0, limit);

    return {
      message: [`## Top ${topStudents.length} Students by GPA`, '', formatStudentTable(topStudents)].join('\n'),
      studentsFound: topStudents.length,
    };
  }

  if (normalized.includes('honor roll') || /gpa (above|over|greater than)/.test(normalized)) {
    const thresholdMatch = normalized.match(/gpa (?:above|over|greater than)\s*(\d(?:\.\d+)?)/);
    const threshold = thresholdMatch ? Number(thresholdMatch[1]) : 3.5;
    const matchingStudents = students.filter((student) => student.gpa >= threshold);

    return {
      message: [
        `## Students With GPA Above ${threshold.toFixed(1)}`,
        '',
        matchingStudents.length > 0 ? formatStudentTable(matchingStudents) : 'No students matched that GPA threshold.',
      ].join('\n'),
      studentsFound: matchingStudents.length,
    };
  }

  if (normalized.includes('attendance') && /(below|under|less than|low)/.test(normalized)) {
    const thresholdMatch = normalized.match(/(?:below|under|less than)\s*(\d+(?:\.\d+)?)/);
    const threshold = thresholdMatch ? Number(thresholdMatch[1]) : 90;
    const matchingStudents = students
      .filter((student) => student.attendance_rate < threshold)
      .sort((left, right) => left.attendance_rate - right.attendance_rate);

    return {
      message: [
        `## Students With Attendance Below ${threshold}%`,
        '',
        matchingStudents.length > 0
          ? formatStudentTable(matchingStudents)
          : 'No students are below that attendance threshold.',
      ].join('\n'),
      studentsFound: matchingStudents.length,
    };
  }

  const subjectMatch = students.filter((student) =>
    student.subjects.some((subject) => normalized.includes(subject.toLowerCase())),
  );
  if (subjectMatch.length > 0) {
    return {
      message: ['## Students Matching the Subject Search', '', formatStudentTable(subjectMatch)].join('\n'),
      studentsFound: subjectMatch.length,
    };
  }

  const gradeMatch = normalized.match(/\bgrade\s*(\d{1,2})\b/);
  const sectionMatch = normalized.match(/\bsection\s*([abc])\b/);
  if (gradeMatch || sectionMatch) {
    const grade = gradeMatch ? Number(gradeMatch[1]) : null;
    const section = sectionMatch ? sectionMatch[1].toUpperCase() : null;
    const matchingStudents = students.filter((student) => {
      if (grade !== null && student.grade_level !== grade) {
        return false;
      }
      if (section !== null && student.class_section !== section) {
        return false;
      }
      return true;
    });

    const titleParts = ['## Student Search Results'];
    if (grade !== null || section !== null) {
      titleParts.push(
        grade !== null && section !== null
          ? `Grade ${grade}, Section ${section}`
          : grade !== null
            ? `Grade ${grade}`
            : `Section ${section}`,
      );
    }

    return {
      message: [
        titleParts.join(' - '),
        '',
        matchingStudents.length > 0 ? formatStudentTable(matchingStudents) : 'No students matched that filter.',
      ].join('\n'),
      studentsFound: matchingStudents.length,
    };
  }

  if (normalized.includes('all students') || normalized.includes('list students')) {
    const rows = [...students].sort((left, right) => left.last_name.localeCompare(right.last_name));
    return {
      message: [`## All Students (${rows.length})`, '', formatStudentTable(rows)].join('\n'),
      studentsFound: rows.length,
    };
  }

  if (normalized.includes('average') || normalized.includes('summary') || normalized.includes('stats')) {
    const averageGpa = students.reduce((total, student) => total + student.gpa, 0) / students.length;
    const averageAttendance =
      students.reduce((total, student) => total + student.attendance_rate, 0) / students.length;
    const activeCount = students.filter((student) => student.status === 'active').length;

    return {
      message: [
        '## Student Dataset Summary',
        '',
        `- Total students: ${students.length}`,
        `- Active students: ${activeCount}`,
        `- Average GPA: ${averageGpa.toFixed(2)}`,
        `- Average attendance: ${averageAttendance.toFixed(1)}%`,
      ].join('\n'),
      studentsFound: students.length,
    };
  }

  return {
    message: [
      'I can help with student search and analysis.',
      '',
      'Try one of these prompts:',
      '- `Show all students in Grade 10`',
      '- `Who are the top 5 students by GPA?`',
      '- `Tell me about Emma Johnson`',
      '- `Which students take Computer Science?`',
      '- `Which students have attendance below 90%?`',
      '',
      'You can also download formal PDF report cards from Student Management.',
    ].join('\n'),
    studentsFound: 0,
  };
};
