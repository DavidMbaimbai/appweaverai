export function formatBundleError(error: unknown) {
  if (error && typeof error === 'object' && 'errors' in error) {
    const errors = (
      error as {
        errors: Array<{
          text: string;
          location?: { file?: string; line?: number; column?: number };
        }>;
      }
    ).errors;

    return errors
      .map((item) => {
        const location = item.location;
        const prefix = location?.file
          ? `${location.file}${location.line ? `:${location.line}` : ''}${location.column ? `:${location.column}` : ''}\n`
          : '';
        return `${prefix}${item.text}`;
      })
      .join('\n\n');
  }

  if (error instanceof Error) return error.message;
  return 'Unknown build error.';
}
