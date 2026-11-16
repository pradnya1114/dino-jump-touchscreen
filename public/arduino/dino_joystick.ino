/*
 * DINO JUMP — Arduino Nano + KY-023 Joystick Controller
 * ----------------------------------------------------
 * Sends "JUMP" over USB Serial (9600 baud) whenever the player
 * pushes the stick UP or clicks the stick button.
 *
 * Wiring (KY-023 -> Arduino Nano):
 *   GND  -> GND
 *   +5V  -> 5V
 *   VRx  -> A0
 *   VRy  -> A1
 *   SW   -> D2
 *
 * Game side: open the PLAY page in Chrome/Edge, click
 * "CONNECT CONTROLLER", pick the Nano's COM port. Done!
 */

// ---- pins ----
const uint8_t PIN_VRX = A0;
const uint8_t PIN_VRY = A1;
const uint8_t PIN_SW  = 2;
const uint8_t PIN_LED = LED_BUILTIN; // blinks on every jump

// ---- tuning ----
const int     TH_UP      = 350;   // Y below this = stick pushed UP
const int     TH_NEUTRAL = 450;   // Y must return above this to re-arm
const uint8_t SW_PRESSED = LOW;   // SW uses internal pull-up
const unsigned long DEBOUNCE_MS = 60;    // ignore chatter faster than this
const unsigned long JUMP_GAP_MS = 180;   // min time between two jumps
const unsigned long TELEM_MS     = 250;   // telemetry heartbeat interval

bool     armed      = true;   // false until stick returns to neutral
bool     lastSw     = HIGH;
int      lastY      = 512;
unsigned long lastJumpAt = 0;
unsigned long lastChange = 0;
unsigned long lastTelem  = 0;

void setup() {
  pinMode(PIN_SW, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  Serial.begin(9600);
  // Wait briefly for USB serial (Nano keeps running regardless).
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 1500) { /* wait */ }
  Serial.println(F("DINO-JUMP READY"));
}

void loop() {
  int x = analogRead(PIN_VRX);   // 0..1023 (left..right)
  int y = analogRead(PIN_VRY);   // 0..1023 (up..down on most KY-023)
  int sw = digitalRead(PIN_SW);  // LOW = clicked
  unsigned long now = millis();

  bool wantJump = (y < TH_UP) || (sw == SW_PRESSED);
  bool neutral  = (y > TH_NEUTRAL) && (sw != SW_PRESSED);

  // Re-arm only after full return to neutral (prevents machine-gun jumps).
  if (neutral) {
    armed = true;
  }

  // Debounce: input must be stable for DEBOUNCE_MS.
  if (wantJump != (lastY < TH_UP || lastSw == SW_PRESSED)) {
    lastChange = now;
  }
  lastY = y;
  lastSw = sw;
  bool stable = (now - lastChange) >= DEBOUNCE_MS;

  if (wantJump && armed && stable && (now - lastJumpAt) >= JUMP_GAP_MS) {
    Serial.println(F("JUMP"));   // <-- the game listens for exactly this
    digitalWrite(PIN_LED, HIGH);
    delay(40);
    digitalWrite(PIN_LED, LOW);
    armed = false;               // require neutral before next jump
    lastJumpAt = now;
  }

  // Heartbeat telemetry so the kiosk can show live stick values.
  if (now - lastTelem >= TELEM_MS) {
    lastTelem = now;
    Serial.print(F("X:"));
    Serial.print(x);
    Serial.print(F(" Y:"));
    Serial.print(y);
    Serial.print(F(" S:"));
    Serial.println(sw == SW_PRESSED ? 0 : 1);
  }

  delay(5);
}
