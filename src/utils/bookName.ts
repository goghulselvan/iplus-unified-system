// "Class 5 Maths Plus Olympiad Book" → "Class 5 Maths", "Class 7 Mock Test - iPlus Olympiads" → "Class 7 Mock Test".
// Class + subject is what staff match against the book cover; the brand tail only hides it.
// Invoice lines snapshot the name at billing time, so pre-rename names pass through unchanged.
export const shortBookName = (name: string) =>
  name
    .replace(/\s+Plus Olympiad Book$/i, '')
    .replace(/\s+-\s+iPlus Olympiads$/i, '')
    .trim();
