// /tmp/test_stats.js
import { sessionManager } from '../src/session/sessionManager.js';
import * as matchStats from '../src/modules/matchStats.js';
import { COINS } from '../src/config/ratingConfig.js';

// Mock sessionManager
const sessions = {
  1: { dbId: 'u1', haxball_name: 'Player1', balance: 100, rating: 1000 },
  2: { dbId: 'u2', haxball_name: 'Player2', balance: 50, rating: 1050 }
};

sessionManager.get = (id) => sessions[id];
sessionManager.allIds = () => Object.keys(sessions).map(Number);
sessionManager.patch = (id, data) => { Object.assign(sessions[id], data); };

// Mock room
const announcements = [];
const roomMock = {
  sendAnnouncement: (msg, targetId, color, style, sound) => {
    announcements.push({ msg, targetId, color, style, sound });
    console.log(`[Announce to ${targetId || 'ALL'}] ${msg}`);
  }
};

// Mock supabase/dbCall
// Since we can't easily mock the imports in ESM without a loader, 
// I'll just test the internal state if possible, or verify the logic manually.
// Actually, I can replace the exported functions in matchStats if I wanted to,
// but it's better to just check if I can run a basic flow.

async function test() {
  console.log("Starting test...");
  
  // Start Match
  await matchStats.startMatch(roomMock, 1, 1);
  
  // Player 1 kicks (Red team)
  matchStats.registerKick({ id: 1, team: 1, x: -450, y: 0 }); // Should be a SAVE
  
  // Player 1 kicks again (Red team)
  matchStats.registerKick({ id: 1, team: 1, x: 0, y: 0 }); // No pass (same player)
  
  // Player 2 kicks (Blue team)
  matchStats.registerKick({ id: 2, team: 2, x: 450, y: 0 }); // Should be a SAVE
  
  // Player 2 kicks again (Blue team)
  matchStats.registerKick({ id: 2, team: 2, x: 100, y: 0 });
  
  // Player 1 kicks (Red team) 
  matchStats.registerKick({ id: 1, team: 1, x: -100, y: 0 });
  
  // Player 1 kicks (Red team) - Goal!
  matchStats.registerGoal(roomMock, 1); // Scorer: 1
  
  // Another goal for Blue
  matchStats.registerKick({ id: 2, team: 2, x: 0, y: 0 });
  matchStats.registerGoal(roomMock, 2); // Scorer: 2
  
  // Finalize Match (Red wins 2-1?) No, wait, I just registered two goals.
  // Let's say Blue won.
  console.log("\nFinalizing Match...");
  await matchStats.finalizeMatch(roomMock, 2, 1, 2);
  
  console.log("\nAnnouncements sent:");
  console.table(announcements);
  
  console.log("\nUpdated Sessions:");
  console.table(sessions);
}

// Note: This script needs to be run with a mock for supabase import.
// For now, I'll just check if the logic in the file looks sound.
// Since I can't easily run it due to DB dependencies, I'll perform a dry run review.
