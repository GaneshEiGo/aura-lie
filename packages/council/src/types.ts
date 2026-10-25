export interface CouncilMember {
  id: string;
  name: string;
  role: string;
  modelId: string;
}

export interface CouncilDraft {
  memberId: string;
  content: string;
  vote: 'yes' | 'no' | 'abstain';
  reasoning: string;
}

export interface CouncilResult {
  drafts: CouncilDraft[];
  synthesis: string;
  dissentCount: number;
  isSimulated: boolean;
}