"use client";

import { useEffect } from "react";
import { usePath } from "@/lib/nav";
import { startKioskRuntime } from "@/lib/sync";
import { HardwareScreen } from "@/screens/HardwareScreen";
import { PlayScreen } from "@/screens/PlayScreen";
import { ResultsScreen } from "@/screens/ResultsScreen";
import { RulesScreen } from "@/screens/RulesScreen";
import { WelcomeScreen } from "@/screens/WelcomeScreen";

/**
 * The whole kiosk. Every route renders this one component and it shows the
 * screen that matches the address bar, so moving between the four pages never
 * needs the server — the player journey works with no connection.
 *
 * It also starts the background work: saving to the database when it can be
 * reached, and keeping a copy of the app on the device for offline use.
 */
export function KioskApp({ initialPath }: { initialPath: string }) {
  const path = usePath(initialPath);

  useEffect(() => startKioskRuntime(), []);

  switch (path) {
    case "/rules":
      return <RulesScreen />;
    case "/play":
      return <PlayScreen />;
    case "/results":
      return <ResultsScreen />;
    case "/hardware":
      return <HardwareScreen />;
    default:
      return <WelcomeScreen />;
  }
}
