import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import iplusLogo from '@/assets/iplus-logo.png';
import { formatRegistrationNumberDisplay, stripSubjectPrefix } from './registrationNumberFormatter';

interface StudentRegistration {
  id: string;
  student_name: string;
  student_class: string;
  registration_number_generated?: string;
  student_subjects?: Array<{
    olympiad_subjects: {
      subject_code: string;
      subject_name: string;
    };
  }>;
}

interface SubjectGroup {
  subjectCode: string;
  subjectName: string;
  students: StudentRegistration[];
}

const CLASS_ORDER: Record<string, number> = {
  'LKG': 0,
  'UKG': 1,
  '1': 2,
  '2': 3,
  '3': 4,
  '4': 5,
  '5': 6,
  '6': 7,
  '7': 8,
  '8': 9,
  '9': 10,
  '10': 11,
  '11': 12,
  '12': 13,
};

export class StudentRegistrationPdfGenerator {
  private pdfDoc!: PDFDocument;
  private helveticaFont!: any;
  private helveticaBoldFont!: any;
  private logoImageBytes!: ArrayBuffer;
  private componentOrder: string[] = ['subject', 'state', 'district', 'school', 'class', 'student'];
  private separator: string = '-';

  async initialize() {
    this.pdfDoc = await PDFDocument.create();
    this.helveticaFont = await this.pdfDoc.embedFont(StandardFonts.Helvetica);
    this.helveticaBoldFont = await this.pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Load logo
    const response = await fetch(iplusLogo);
    this.logoImageBytes = await response.arrayBuffer();
  }

  setRegistrationFormat(componentOrder: string[], separator: string) {
    this.componentOrder = componentOrder;
    this.separator = separator;
  }

  private groupAndSortBySubject(registrations: StudentRegistration[], filterSubjectCode?: string): SubjectGroup[] {
    const subjectMap = new Map<string, { name: string; students: StudentRegistration[] }>();

    registrations.forEach(reg => {
      reg.student_subjects?.forEach(ss => {
        const code = ss.olympiad_subjects.subject_code;
        const name = ss.olympiad_subjects.subject_name;
        
        if (filterSubjectCode && code !== filterSubjectCode) {
          return;
        }

        if (!subjectMap.has(code)) {
          subjectMap.set(code, { name, students: [] });
        }
        
        // Only add if not already added for this subject
        const subjectData = subjectMap.get(code)!;
        if (!subjectData.students.find(s => s.id === reg.id)) {
          subjectData.students.push(reg);
        }
      });
    });

    // Convert to array
    const subjectGroups: SubjectGroup[] = [];
    
    subjectMap.forEach((subjectData, code) => {
      // Sort students by class, then by name
      const sortedStudents = subjectData.students.sort((a, b) => {
        const classOrderA = CLASS_ORDER[a.student_class.toUpperCase()] ?? 999;
        const classOrderB = CLASS_ORDER[b.student_class.toUpperCase()] ?? 999;
        
        if (classOrderA !== classOrderB) {
          return classOrderA - classOrderB;
        }
        
        return a.student_name.localeCompare(b.student_name);
      });

      subjectGroups.push({
        subjectCode: code,
        subjectName: subjectData.name, // Use actual subject name from database
        students: sortedStudents,
      });
    });

    // Sort by subject code numerically
    subjectGroups.sort((a, b) => {
      const codeA = parseInt(a.subjectCode) || 999;
      const codeB = parseInt(b.subjectCode) || 999;
      return codeA - codeB;
    });

    return subjectGroups;
  }

  private async addHeader(page: any, schoolName: string, isFirstPage: boolean) {
    const { width, height } = page.getSize();
    
    let currentY = height - 40; // Start with top margin (raised logo by 10pt)
    
    // Add logo (1.2-1.5 inches = ~86-108 points, using 100 points)
    const logoImage = await this.pdfDoc.embedPng(this.logoImageBytes);
    const logoWidth = 100;
    const logoHeight = (logoImage.height / logoImage.width) * logoWidth;
    
    // Center logo horizontally
    page.drawImage(logoImage, {
      x: (width - logoWidth) / 2,
      y: currentY - logoHeight,
      width: logoWidth,
      height: logoHeight,
    });
    
    currentY -= (logoHeight + 15); // Move down by logo height + 15pt gap (lowered by 2pt more)

    // Add "iPlus Olympiads" title (16pt, centered)
    const titleText = 'iPlus Olympiads';
    const titleWidth = this.helveticaBoldFont.widthOfTextAtSize(titleText, 16);
    page.drawText(titleText, {
      x: (width - titleWidth) / 2,
      y: currentY,
      size: 16,
      font: this.helveticaBoldFont,
      color: rgb(0, 0, 0),
    });
    
    currentY -= 24; // Move down by font size + 8pt gap

    // Add school name with wrapping (14pt, centered)
    const schoolNameLines = this.wrapText(schoolName, width - 100, 14);
    schoolNameLines.forEach((line, index) => {
      const lineWidth = this.helveticaBoldFont.widthOfTextAtSize(line, 14);
      page.drawText(line, {
        x: (width - lineWidth) / 2,
        y: currentY - (index * 18),
        size: 14,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
    });
    
    currentY -= (schoolNameLines.length * 18 + 8); // Move down by wrapped lines + 8pt space

    // Add separator line (reduced thickness)
    page.drawLine({
      start: { x: 40, y: currentY },
      end: { x: width - 40, y: currentY },
      thickness: 0.8,
      color: rgb(0, 0, 0),
    });

    return currentY - 20; // Return Y position for content to start
  }

  private addFooter(page: any, pageNumber: number) {
    const { width } = page.getSize();
    
    const pageText = `Page ${pageNumber}`;
    const textWidth = this.helveticaFont.widthOfTextAtSize(pageText, 10);
    
    page.drawText(pageText, {
      x: (width - textWidth) / 2,
      y: 30,
      size: 10,
      font: this.helveticaFont,
      color: rgb(0, 0, 0),
    });
  }

  private wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number = 2): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = this.helveticaBoldFont.widthOfTextAtSize(testLine, fontSize);
      
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines.slice(0, maxLines);
  }

  private addStudentRow(
    page: any,
    student: StudentRegistration,
    x: number,
    y: number,
    columnWidth: number
  ): number {
    const classText = student.student_class;
    const nameLines = this.wrapText(student.student_name, 110, 10, 2);
    // Display registration number without the leading subject-code prefix (UI convention)
    const regNumber = stripSubjectPrefix(student.registration_number_generated);
    
    // Calculate row height based on wrapped lines
    const rowHeight = nameLines.length > 1 ? 30 : 18;
    
    // Define column widths
    const classWidth = 35;
    const nameWidth = 120;
    const regNumberWidth = 120;
    
    // Draw cell borders (thin black lines)
    const borderColor = rgb(0, 0, 0);
    const borderThickness = 0.5;
    
    // Class cell border
    page.drawRectangle({
      x: x,
      y: y - rowHeight + 12,
      width: classWidth,
      height: rowHeight,
      borderColor: borderColor,
      borderWidth: borderThickness,
    });
    
    // Name cell border
    page.drawRectangle({
      x: x + classWidth,
      y: y - rowHeight + 12,
      width: nameWidth,
      height: rowHeight,
      borderColor: borderColor,
      borderWidth: borderThickness,
    });
    
    // Registration number cell border
    page.drawRectangle({
      x: x + classWidth + nameWidth,
      y: y - rowHeight + 12,
      width: regNumberWidth,
      height: rowHeight,
      borderColor: borderColor,
      borderWidth: borderThickness,
    });

    // Draw class text (10pt)
    page.drawText(classText, {
      x: x + 2,
      y: y - 2,
      size: 10,
      font: this.helveticaFont,
      color: rgb(0, 0, 0),
    });

    // Draw student name (wrapped, 10pt)
    nameLines.forEach((line, index) => {
      page.drawText(line, {
        x: x + classWidth + 2,
        y: y - 2 - (index * 12),
        size: 10,
        font: this.helveticaFont,
        color: rgb(0, 0, 0),
      });
    });

    // Draw registration number (10pt)
    page.drawText(regNumber, {
      x: x + classWidth + nameWidth + 2,
      y: y - 2,
      size: 10,
      font: this.helveticaFont,
      color: rgb(0, 0, 0),
    });

    // Return proper row height based on wrapped lines
    return rowHeight;
  }

  private async add2ColumnLayout(
    pages: any[],
    students: StudentRegistration[],
    startY: number,
    pageNumber: number,
    schoolName: string
  ): Promise<{ pageNumber: number; currentY: number }> {
    const leftColumnX = 40;
    const rightColumnX = 315;
    const minBottomMargin = 80;
    
    // Split students into two balanced columns
    const totalStudents = students.length;
    const leftColumnCount = Math.ceil(totalStudents / 2);
    const leftColumnStudents = students.slice(0, leftColumnCount);
    const rightColumnStudents = students.slice(leftColumnCount);

    // Process both columns together, row by row
    let currentPage = pages[pages.length - 1];
    let currentY = startY;
    const maxRows = Math.max(leftColumnStudents.length, rightColumnStudents.length);
    
    for (let i = 0; i < maxRows; i++) {
      // Calculate the row height needed (take max of both columns if both exist)
      let rowHeight = 18; // default
      
      if (i < leftColumnStudents.length) {
        const leftNameLines = this.wrapText(leftColumnStudents[i].student_name, 110, 10, 2);
        rowHeight = Math.max(rowHeight, leftNameLines.length > 1 ? 30 : 18);
      }
      
      if (i < rightColumnStudents.length) {
        const rightNameLines = this.wrapText(rightColumnStudents[i].student_name, 110, 10, 2);
        rowHeight = Math.max(rowHeight, rightNameLines.length > 1 ? 30 : 18);
      }
      
      // Check if we need a new page for this row
      if (currentY - rowHeight < minBottomMargin) {
        pageNumber++;
        currentPage = this.pdfDoc.addPage([612, 792]);
        pages.push(currentPage);
        currentY = currentPage.getSize().height - 40; // Start from top with margin
        this.addFooter(currentPage, pageNumber);
      }

      // Draw left column student if exists
      if (i < leftColumnStudents.length) {
        this.addStudentRow(currentPage, leftColumnStudents[i], leftColumnX, currentY, 0);
      }
      
      // Draw right column student if exists
      if (i < rightColumnStudents.length) {
        this.addStudentRow(currentPage, rightColumnStudents[i], rightColumnX, currentY, 0);
      }
      
      // Move down by the row height
      currentY -= rowHeight;
    }

    return { pageNumber, currentY };
  }

  async generatePDF(
    registrations: StudentRegistration[],
    schoolName: string,
    filterSubjectCode?: string
  ): Promise<Uint8Array> {
    await this.initialize();

    // Sanitize school name - replace newlines and extra whitespace
    const sanitizedSchoolName = schoolName
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const subjectGroups = this.groupAndSortBySubject(registrations, filterSubjectCode);

    if (subjectGroups.length === 0) {
      throw new Error('No registrations found');
    }

    const pages: any[] = [];
    let pageNumber = 1;

    // First page
    const firstPage = this.pdfDoc.addPage([612, 792]);
    pages.push(firstPage);
    let currentY = await this.addHeader(firstPage, sanitizedSchoolName, true);
    this.addFooter(firstPage, pageNumber);

    // Add subject sections
    for (let i = 0; i < subjectGroups.length; i++) {
      const group = subjectGroups[i];

      // Add spacing before subject (except first one)
      if (i > 0) {
        currentY -= 60; // 4 rows of spacing
      }

      // Calculate space needed for complete subject block:
      // - Subject heading: ~25pt (16pt font + spacing)
      // - Column headers with borders: ~20pt
      // - Minimum 3 rows of data: ~54pt (18pt per row minimum)
      // - Bottom margin safety: 80pt
      // Total: ~179pt
      const subjectHeadingSpace = 25;
      const columnHeadersSpace = 20;
      const minStudentRows = 3;
      const minRowHeight = 18;
      const bottomMargin = 80;
      const neededSpace = subjectHeadingSpace + columnHeadersSpace + (minStudentRows * minRowHeight) + bottomMargin;
      
      // If not enough space for subject title + headers + at least 3 rows, move to next page
      if (currentY < neededSpace) {
        pageNumber++;
        const newPage = this.pdfDoc.addPage([612, 792]);
        pages.push(newPage);
        currentY = newPage.getSize().height - 40; // Start from top with margin
        this.addFooter(newPage, pageNumber);
      }

      // Add subject heading
      const currentPage = pages[pages.length - 1];
      currentPage.drawText(group.subjectName, {
        x: 40,
        y: currentY,
        size: 16,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });

      currentY -= 25;

      // Define column widths and header height
      const headerHeight = 18;
      const classWidth = 35;
      const nameWidth = 120;
      const regNumberWidth = 120;
      const borderColor = rgb(0, 0, 0);
      const borderThickness = 0.5;

      // Left column header borders
      currentPage.drawRectangle({
        x: 40,
        y: currentY - headerHeight + 10,
        width: classWidth,
        height: headerHeight,
        borderColor: borderColor,
        borderWidth: borderThickness,
      });
      currentPage.drawRectangle({
        x: 40 + classWidth,
        y: currentY - headerHeight + 10,
        width: nameWidth,
        height: headerHeight,
        borderColor: borderColor,
        borderWidth: borderThickness,
      });
      currentPage.drawRectangle({
        x: 40 + classWidth + nameWidth,
        y: currentY - headerHeight + 10,
        width: regNumberWidth,
        height: headerHeight,
        borderColor: borderColor,
        borderWidth: borderThickness,
      });

      // Right column header borders
      currentPage.drawRectangle({
        x: 315,
        y: currentY - headerHeight + 10,
        width: classWidth,
        height: headerHeight,
        borderColor: borderColor,
        borderWidth: borderThickness,
      });
      currentPage.drawRectangle({
        x: 315 + classWidth,
        y: currentY - headerHeight + 10,
        width: nameWidth,
        height: headerHeight,
        borderColor: borderColor,
        borderWidth: borderThickness,
      });
      currentPage.drawRectangle({
        x: 315 + classWidth + nameWidth,
        y: currentY - headerHeight + 10,
        width: regNumberWidth,
        height: headerHeight,
        borderColor: borderColor,
        borderWidth: borderThickness,
      });

      // Add column headers (10pt) - Left column
      currentPage.drawText('Class', {
        x: 42,
        y: currentY - 2,
        size: 10,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      currentPage.drawText('Student Name', {
        x: 77,
        y: currentY - 2,
        size: 10,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      currentPage.drawText('Registration Number', {
        x: 197,
        y: currentY - 2,
        size: 10,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });

      // Right column headers
      currentPage.drawText('Class', {
        x: 317,
        y: currentY - 2,
        size: 10,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      currentPage.drawText('Student Name', {
        x: 352,
        y: currentY - 2,
        size: 10,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      currentPage.drawText('Registration Number', {
        x: 472,
        y: currentY - 2,
        size: 10,
        font: this.helveticaBoldFont,
        color: rgb(0, 0, 0),
      });

      currentY -= 20;

      // Add students in 2-column layout
      const result = await this.add2ColumnLayout(pages, group.students, currentY, pageNumber, schoolName);
      pageNumber = result.pageNumber;
      currentY = result.currentY;
    }

    return await this.pdfDoc.save();
  }
}

export async function generateStudentRegistrationPdf(
  registrations: StudentRegistration[],
  schoolName: string,
  filterSubjectCode?: string,
  componentOrder?: string[],
  separator?: string
): Promise<void> {
  const generator = new StudentRegistrationPdfGenerator();
  
  if (componentOrder && separator) {
    generator.setRegistrationFormat(componentOrder, separator);
  }
  
  const pdfBytes = await generator.generatePDF(registrations, schoolName, filterSubjectCode);
  
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  const fileName = filterSubjectCode 
    ? `${schoolName}_Subject_${filterSubjectCode}_registrations.pdf`
    : `${schoolName}_all_registrations.pdf`;
  
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
