/**
 * Convert a number to Indian Rupees in words
 * Examples:
 * - 1250.50 → "Rupees One Thousand Two Hundred Fifty and Fifty Paise Only"
 * - 1250.00 → "Rupees One Thousand Two Hundred Fifty Only"
 * - 0.50 → "Fifty Paise Only"
 */

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

function convertLessThanThousand(num: number): string {
  if (num === 0) return '';
  
  let result = '';
  
  if (num >= 100) {
    result += ones[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }
  
  if (num >= 20) {
    result += tens[Math.floor(num / 10)] + ' ';
    num %= 10;
  } else if (num >= 10) {
    result += teens[num - 10] + ' ';
    return result.trim();
  }
  
  if (num > 0) {
    result += ones[num] + ' ';
  }
  
  return result.trim();
}

export function numberToWords(amount: number): string {
  if (amount === 0) return 'Zero Rupees Only';
  
  // Split into rupees and paise
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  
  let result = '';
  
  // Convert rupees
  if (rupees > 0) {
    let remaining = rupees;
    const parts: string[] = [];
    
    // Crores
    if (remaining >= 10000000) {
      parts.push(convertLessThanThousand(Math.floor(remaining / 10000000)) + ' Crore');
      remaining %= 10000000;
    }
    
    // Lakhs
    if (remaining >= 100000) {
      parts.push(convertLessThanThousand(Math.floor(remaining / 100000)) + ' Lakh');
      remaining %= 100000;
    }
    
    // Thousands
    if (remaining >= 1000) {
      parts.push(convertLessThanThousand(Math.floor(remaining / 1000)) + ' Thousand');
      remaining %= 1000;
    }
    
    // Hundreds, tens, ones
    if (remaining > 0) {
      parts.push(convertLessThanThousand(remaining));
    }
    
    result = 'Rupees ' + parts.join(' ');
  }
  
  // Convert paise
  if (paise > 0) {
    const paiseWords = convertLessThanThousand(paise);
    if (result) {
      result += ' and ' + paiseWords + ' Paise';
    } else {
      result = paiseWords + ' Paise';
    }
  }
  
  return result + ' Only';
}
