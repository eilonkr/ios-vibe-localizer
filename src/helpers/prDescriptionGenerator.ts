export interface TranslationChanges {
  added: string[];
  updated: string[];
  staleRemoved: string[];
}

/**
 * Generates a detailed PR description that includes a summary of all translation changes.
 * @param basePrBody The base PR body text from configuration
 * @param translationChanges Object containing arrays of added, updated, and removed translations
 * @param targetLanguages Array of target language codes
 * @param changedFilesList Array of files that were modified
 * @returns Complete PR description with detailed change summary
 */
export function generatePrDescription(
  basePrBody: string,
  translationChanges?: TranslationChanges,
  targetLanguages?: string[],
  changedFilesList?: string[]
): string {
  let finalPrBody = basePrBody;
  
  // Add detailed translation changes summary
  if (translationChanges && targetLanguages) {
    const totalChanges = translationChanges.added.length + translationChanges.updated.length + translationChanges.staleRemoved.length;
    
    if (totalChanges > 0) {
      finalPrBody += '\n\n## Translation Changes Summary\n\n';
      finalPrBody += `**Target Languages:** ${targetLanguages.join(', ')}\n`;
      finalPrBody += `**Total Changes:** ${totalChanges}\n\n`;
      
      if (translationChanges.added.length > 0) {
        finalPrBody += `### ✅ Added Translations (${translationChanges.added.length})\n`;
        for (const change of translationChanges.added) {
          finalPrBody += `- ${change}\n`;
        }
        finalPrBody += '\n';
      }
      
      if (translationChanges.updated.length > 0) {
        finalPrBody += `### 🔄 Updated Translations (${translationChanges.updated.length})\n`;
        for (const change of translationChanges.updated) {
          finalPrBody += `- ${change}\n`;
        }
        finalPrBody += '\n';
      }
      
      if (translationChanges.staleRemoved.length > 0) {
        finalPrBody += `### 🗑️ Removed Stale Strings (${translationChanges.staleRemoved.length})\n`;
        for (const change of translationChanges.staleRemoved) {
          finalPrBody += `- ${change}\n`;
        }
        finalPrBody += '\n';
      }
    }
  }
  
  if (changedFilesList && changedFilesList.length > 0) {
    finalPrBody += `\n**Updated files:**\n- ${changedFilesList.join('\n- ')}`;
  }
  
  return finalPrBody;
} 