export function enforceIdentity(query: string, response: string): string {
  const lowerQuery = query.toLowerCase();
  
  const humanQuestions = [
    "are you human",
    "are you a real person",
    "is this a human",
    "are you an ai"
  ];

  const isAskingIfHuman = humanQuestions.some(q => lowerQuery.includes(q));

  if (isAskingIfHuman) {
    return "No. I'm Aura-lie, an AI. I'm built to sound natural, not to pretend.";
  }

  return response;
}