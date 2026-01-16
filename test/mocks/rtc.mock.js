import { vi } from 'vitest';

export function createMockRTC() {
  return {
    PeerConnection: vi.fn(),
    offerPeer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
    answerPeer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' }),
  };
}
