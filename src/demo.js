export const conversation = [
  ['A', 'Zosia', 'dawaj, chopie!'],
  ['B', 'Sam', 'That jump was incredible!'],
  ['A', 'Marek', 'Ale akcja! Jeszcze jedna runda?'],
  ['B', 'Riley', 'One more round! We can do this together.'],
  ['A', 'Ola', 'Dobra robota @Sam Kappa'],
  ['B', 'Alex', 'Hello Polish chat! Good luck!'],
  ['A', 'Kuba', 'Dzięki! Gramy razem!'],
  ['B', 'Jamie', 'Two chats, one team. GG']
];

export function startDemo(inject, { a, b, intervalMs = 1800 } = {}) {
  let index = 0;
  const play = () => {
    const [side, user, text] = conversation[index++ % conversation.length];
    inject({ channel: side === 'A' ? a : b, user, text });
  };
  const first = setTimeout(play, 500);
  const timer = setInterval(play, intervalMs);
  return () => { clearTimeout(first); clearInterval(timer); };
}