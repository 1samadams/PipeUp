// Room-code generation. Short, unambiguous, no 0/O/1/I so codes are easy to
// read aloud and type from a shared screen.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

function randomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

// Generate a code, retrying until `isTaken(code)` returns false. The caller
// passes a collision check against the active room store.
export function generateCode(isTaken = () => false) {
  let code = randomCode();
  let guard = 0;
  while (isTaken(code) && guard++ < 50) {
    code = randomCode();
  }
  return code;
}
