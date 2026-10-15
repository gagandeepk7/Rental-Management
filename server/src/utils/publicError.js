export function publicDatabaseError(error) {
  console.error(JSON.stringify({ type: 'database_error', code: error?.code || 'unknown' }));
  const messages = {
    '23505': 'A record with these details already exists.',
    '23P01': 'This time slot or assignment overlaps an existing reservation.',
    '23503': 'A related record is no longer available. Refresh and try again.',
    '23514': 'Some supplied values do not meet the required rules.',
  };
  return messages[error?.code] || 'Unable to process this request. Please try again.';
}
