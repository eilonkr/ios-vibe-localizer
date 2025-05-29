export interface XCStrings {
  sourceLanguage: string;
  strings: {
    [key: string]: {
      comment?: string;
      localizations?: {
        [lang: string]: {
          stringUnit: {
            state: string;
            value: string;
          };
        };
      };
    };
  };
  version: string;
} 