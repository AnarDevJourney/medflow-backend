// Escapes LIKE wildcards so a search for "50%" matches literally
export const likePattern = (search: string) =>
  `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
