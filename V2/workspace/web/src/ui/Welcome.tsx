import React, { useState } from "react";
import npecLogo from "../assets/NPEC.png";
import { LeafButton } from "../LeafButton";

type WelcomeTabKey = "about" | "tutorial" | "tabs" | "disclaimer";

export default function Welcome() {
  const [activeTab, setActiveTab] = useState<WelcomeTabKey>("about");

  const TabButton = ({ tabKey, label }: { tabKey: WelcomeTabKey; label: string }) => (
    <LeafButton
      onClick={() => setActiveTab(tabKey)}
      style={{
        filter: activeTab === tabKey ? "drop-shadow(0 0 10px rgba(34, 197, 94, 0.7)) brightness(1.15)" : "brightness(0.92)",
        transition: "all 0.3s ease",
        transform: activeTab === tabKey ? "scale(1.08)" : "scale(0.98)",
      }}
    >
      <span
        style={{
          color: activeTab === tabKey ? "#16a34a" : "#000000",
          fontWeight: activeTab === tabKey ? 700 : 600,
          fontSize: "0.9rem",
        }}
      >
        {label}
      </span>
    </LeafButton>
  );

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex items-center justify-center gap-8 mb-8">
        <img src={npecLogo} alt="NPEC logo" className="h-40 w-auto" />
        <div className="text-left">
          <h1 className="text-5xl font-bold text-gray-800 mb-3">
            Welcome to <span className="text-green-600">Faketron</span>
          </h1>
          <p className="text-xl text-gray-600">
            A mock Fytotron Client protocol editor and viewer for Wageningen walk-in chambers G4-G8
          </p>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-4 border-b border-gray-200 pb-4 mb-8">
        <TabButton tabKey="about" label="About & Credits" />
        <TabButton tabKey="tutorial" label="User Guide" />
        <TabButton tabKey="tabs" label="Tab Overview" />
        <TabButton tabKey="disclaimer" label="Disclaimer" />
      </div>

      <div className="bg-white rounded-lg shadow-lg p-8">
        {activeTab === "about" && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-6 rounded-lg border border-indigo-100">
              <h2 className="text-3xl font-bold text-gray-800 mb-4">Credits & Version</h2>
              <div className="space-y-2 text-gray-700">
                <p className="text-lg">
                  <strong>Made by:</strong> Maarten Bots and Danna Shao
                </p>
                <p className="text-lg">
                  <strong>Version:</strong> V3 (17-04-2026)
                </p>
              </div>
            </div>

            <div className="bg-blue-50 p-6 rounded-lg border border-blue-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Example Protocols Available</h3>
              <p className="text-gray-700 mb-2">
                Download from the <strong>Google Drive</strong> above: <strong>G4, G5, G6, G7, G8</strong> (including experimental variants)
              </p>
              <p className="text-gray-600 italic">
                Feel free to load these examples to explore the features and build your own protocols.
              </p>
            </div>

            <div className="bg-gradient-to-br from-green-100 via-emerald-50 to-teal-50 p-8 rounded-xl border-2 border-green-400 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-3xl font-bold text-gray-800">Download Resources</h3>
              </div>
              <div className="bg-white p-6 rounded-lg shadow-md border-2 border-green-300 mb-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-green-800 mb-2">Main Resource Drive</h4>
                    <p className="text-gray-700 mb-3 font-semibold">
                      Download example protocols, CSV files, and PDF tutorial:
                    </p>
                    <a
                      href="https://drive.google.com/drive/u/1/folders/1gZKerfe52QwXIYPSa2mCQGP49loRlIfO"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-md hover:shadow-xl text-lg"
                    >
                      Open Google Drive Resources
                    </a>
                    <div className="mt-4 bg-green-50 p-4 rounded border border-green-200">
                      <p className="font-semibold text-green-900 mb-2">What's included in the Drive:</p>
                      <ul className="space-y-1 text-gray-700 ml-4">
                        <li><strong>Example .fyt protocol files</strong> (G4, G5, G6, G7, G8)</li>
                        <li><strong>CSV template files</strong> for importing time-series data</li>
                        <li><strong>PDF tutorial</strong> with step-by-step instructions</li>
                        <li><strong>Sample experimental protocols</strong></li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg border border-gray-300">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>For Advanced Users & Developers:</strong>
                </p>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li><strong>GitHub Repository:</strong> <a href="https://github.com/NPEC-NL/Faketotron" className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">https://github.com/NPEC-NL/Faketotron</a></li>
                  <li><strong>Online Access:</strong> <a href="https://www.npec.nl/faketron.html" className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">https://www.npec.nl/faketron.html</a></li>
                </ul>
              </div>
            </div>

            <div className="bg-blue-50 p-6 rounded-lg border border-blue-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Intended For</h3>
              <p className="text-gray-700 text-lg">
                NPEC operators and users working with Wageningen walk-in chambers
              </p>
            </div>
          </div>
        )}

        {activeTab === "tutorial" && (
          <div className="space-y-6 text-gray-700">
            <section>
              <h2 className="text-3xl font-bold text-gray-800 mb-4">Faketron User Guide</h2>
              <p className="text-lg mb-4">
                A mock Fytotron Client protocol editor and viewer (.html, runs in the browser).
                Faketron helps you build complex Wageningen walk-in chambers G4-G8 protocols.
              </p>
            </section>

            <section className="bg-indigo-50 p-6 rounded-lg border border-indigo-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Why use Faketron instead of PSI Fytotron?</h3>
              <ul className="space-y-2 ml-4">
                <li>All the same original features from PSI Fytotron, with some added features</li>
                <li>Internet accessible: Access via <a href="https://www.npec.nl/faketron.html" className="text-indigo-600 hover:underline">https://www.npec.nl/faketron.html</a></li>
                <li>Enhanced visualizations: Use dedicated graphs to inspect one 24-hour window, compare day patterns across an experiment, and fine-tune the full protocol</li>
                <li>Copy-paste efficiency: Build the final 24 hours for all groups once, then use the repeat-last-24-hours button to copy-paste that 24-hour block across as many experiment days as you need</li>
                <li>CSV import: Import time-series data with second resolution and paste over phases</li>
                <li>Cities feature: Use one of the currently available five city datasets, choose the desired date or month profile, and generate Faketron-ready settings from it</li>
                <li>Optimized storage: Only stores seconds when there is a change (unlike Fytotron's 100,000s of rows)</li>
                <li>Export & reload: Export machine-readable .fyt files and load them back for review or modification</li>
              </ul>
            </section>

            <section className="bg-yellow-50 p-6 rounded-lg border border-yellow-200">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Limits & Best Practices</h3>
              <ul className="space-y-2 ml-4">
                <li>Maximum duration: 45 days is recommended</li>
                <li>
                  Time format: D.HH:MM:SS (Days.Hours:Minutes:Seconds)
                  <ul className="ml-6 mt-1 text-sm">
                    <li>01:30:00 = 1 hour 30 minutes</li>
                    <li>1.00:00:00 = exactly 24 hours</li>
                    <li>1.06:00:00 = 30 hours</li>
                  </ul>
                </li>
                <li>Group duration: Total duration of each group must be the same</li>
                <li>Constant parameters: If a parameter does not need changes, add a single constant phase for the full duration (for example UV light at 0)</li>
                <li>Humidity minimum: 50 is the minimum you can set</li>
                <li>CO2: No CO2 scrubbing available</li>
                <li>Edit Groups: Do not use unless you are using non-standard Groups</li>
              </ul>
            </section>

            <section>
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Key Concepts</h3>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="font-bold text-gray-800 mb-2">Variables (what you control)</h4>
                  <p className="text-sm">Examples: Temperature, CO2, Cool White, Deep Red, Far Red, Humidity, UVB</p>
                </div>

                <div className="bg-purple-50 p-4 rounded-lg">
                  <h4 className="font-bold text-gray-800 mb-2">Phases (how values change over time)</h4>
                  <p className="text-sm">Protocols are built from phases that run in order</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="border-l-4 border-green-500 pl-4 py-2 bg-green-50">
                  Constant: Hold one value for a duration<br />
                  <span className="text-sm text-gray-600">Example: 21 deg C for 16 hours</span>
                </div>
                <div className="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50">
                  Ramp: Move linearly from start to end<br />
                  <span className="text-sm text-gray-600">Example: 16 to 21 deg C in 30 minutes</span>
                </div>
                <div className="border-l-4 border-purple-500 pl-4 py-2 bg-purple-50">
                  Sine: Smooth oscillation between min/max with a period<br />
                  <span className="text-sm text-gray-600">Example: Circadian-like changes</span>
                </div>
                <div className="border-l-4 border-yellow-500 pl-4 py-2 bg-yellow-50">
                  Cloud: Pseudo-random cloud-cover behavior<br />
                  <span className="text-sm text-gray-600">Useful for realistic flicker patterns</span>
                </div>
              </div>
            </section>

            <div className="bg-gradient-to-r from-yellow-50 to-amber-50 p-6 rounded-lg border-2 border-yellow-300 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-2xl font-bold text-gray-800">Need Help? Download the PDF Tutorial!</h3>
              </div>
              <p className="text-gray-700 mb-3">
                A complete step-by-step PDF tutorial is available in the Google Drive (link below).
                Perfect for first-time users.
              </p>
            </div>

            <section className="bg-green-50 p-6 rounded-lg border border-green-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Quick Start (Recommended Workflow)</h3>

              <div className="bg-white p-4 rounded-lg border border-green-200 mb-4">
                <p className="font-bold text-green-800 mb-2">First Time? Download Example Files:</p>
                <p className="text-gray-700">
                  Visit the <a href="https://drive.google.com/drive/u/1/folders/1gZKerfe52QwXIYPSa2mCQGP49loRlIfO" className="text-green-600 hover:underline font-semibold" target="_blank" rel="noopener noreferrer">Google Drive</a> to download example .fyt protocols and the PDF tutorial before starting.
                </p>
              </div>

              <h4 className="font-bold text-gray-800 mt-4 mb-2">Loading or Creating a Protocol:</h4>
              <ul className="space-y-1 ml-4">
                <li>Load protocol: Choose "Load" and select a .fyt file (download examples from Drive first)</li>
                <li>New protocol: Choose "New" in the protocol panel</li>
              </ul>

              <h4 className="font-bold text-gray-800 mt-4 mb-2">Building the Protocol (Step-by-step):</h4>
              <ol className="space-y-1 ml-6 list-decimal">
                <li>Pick a Group (for example Temperature Group 1)</li>
                <li>Click Add Phase</li>
                <li>Choose the phase type (Constant / Ramp / Sine / Cloud)</li>
                <li>Enter value(s) and duration</li>
                <li>Repeat until the full schedule is defined</li>
                <li>Drag rows if you need to reorder phases</li>
                <li>Tip: First make all groups exactly 24 hours. Then use the repeat-last-24-hours button to copy-paste that final 24-hour block for all groups at the same time.</li>
                <li>After the germination stage, you can do the same again for the first experimental phase: build one full 24-hour day, then repeat it for as many days as you want.</li>
                <li>Make sure ALL Groups have the same total duration (for example constant groups like UVB at 0% for most of the day, should be the total duration)</li>
              </ol>

              <h4 className="font-bold text-gray-800 mt-4 mb-2">How to Use the Graphs:</h4>
              <ul className="space-y-1 ml-4">
                <li>Use the 24-hour graph view to inspect one complete day in detail and verify that the copied daily schedule looks correct.</li>
                <li>Use the day scroller to move through long protocols and check whether each repeated 24-hour block still matches your intended design.</li>
                <li>Use the Experimental Duration Graph to compare selected days hour by hour and quickly see which parameters change between days.</li>
                <li>Use the Flexible Graph when you want the full experiment timeline with zoom, scrolling, and read-only phase inspection.</li>
              </ul>

              <h4 className="font-bold text-gray-800 mt-4 mb-2">Cities Feature:</h4>
              <p className="text-gray-700">
                In the Cities tab you can currently work with five city datasets. Choose a city file, select the relevant date or month profile, apply the available settings, and generate a Faketron day profile that you can load into the protocol workflow.
              </p>

              <h4 className="font-bold text-gray-800 mt-4 mb-2">Save / Export:</h4>
              <ul className="space-y-1 ml-4">
                <li>Before saving, add a clear description: experiment name, chamber, start date, and protocol controls</li>
                <li>.fyt file: Machine-readable protocol file for PSI systems</li>
              </ul>
            </section>
          </div>
        )}

        {activeTab === "tabs" && (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-6">Application Tabs Overview</h2>

            <div className="grid gap-6">
              <div className="bg-indigo-50 p-6 rounded-lg border-l-4 border-indigo-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">Editor Tab</h3>
                <p className="text-gray-700">
                  The main protocol editor interface. Here you can create, edit, and manage your protocol phases.
                  Add groups, define phases (constant, ramp, sine, cloud), set durations, and arrange the sequence
                  of your experiment. This is where you will spend most of your time building protocols.
                </p>
              </div>

              <div className="bg-purple-50 p-6 rounded-lg border-l-4 border-purple-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">Graph Tab</h3>
                <p className="text-gray-700">
                  Visualize your protocol in several ways. One graph always shows a single 24-hour window so you can
                  inspect the daily schedule in detail, while the Experimental Duration Graph compares selected days
                  hour by hour to show which parameters really change across the experiment. The Flexible Graph shows
                  the full timeline with zoom, scrolling, and phase inspection.
                </p>
              </div>

              <div className="bg-yellow-50 p-6 rounded-lg border-l-4 border-yellow-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">Light Tools Tab</h3>
                <p className="text-gray-700">
                  Advanced light spectrum management. Fine-tune individual light channels (Cool White, Warm White,
                  Deep Red, Far Red, UVB, etc.). Calculate PPFD values, manage light ratios, and ensure your
                  lighting conditions match your experimental requirements precisely.
                </p>
              </div>

              <div className="bg-green-50 p-6 rounded-lg border-l-4 border-green-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">CSV Tab</h3>
                <p className="text-gray-700">
                  Import time-series data from CSV files with second-level resolution. Paste imported data over
                  existing phases to create complex, data-driven protocols. Useful for replicating real-world
                  conditions from sensor data or implementing custom environmental patterns from external sources.
                </p>
              </div>

              <div className="bg-blue-50 p-6 rounded-lg border-l-4 border-blue-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">Cities Tab</h3>
                <p className="text-gray-700">
                  Generate a Faketron day profile from the currently available city daylight datasets. You can choose
                  a city source, select the relevant date or month profile, combine it with calibration settings, and
                  produce settings that can be loaded back into your protocol workflow.
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border border-indigo-200 mt-6">
              <h3 className="text-xl font-bold text-gray-800 mb-3">Pro Tips</h3>
              <ul className="space-y-2 text-gray-700">
                <li>Start with the Editor to build your protocol structure</li>
                <li>Switch to the Graph frequently to validate your design</li>
                <li>Use Light Tools for precise spectral control</li>
                <li>Use Cities when you want to start from daylight-based city profiles</li>
                <li>Import real-world data via CSV for authentic conditions</li>
                <li>Always check all tabs before exporting your final .fyt file</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === "disclaimer" && (
          <div className="space-y-6">
            <div className="bg-red-50 p-8 rounded-lg border-2 border-red-200">
              <h2 className="text-3xl font-bold text-red-800 mb-4">Important Disclaimer</h2>

              <div className="space-y-4 text-gray-800 leading-relaxed">
                <p>
                  This software is an independent, non-commercial imitation of certain user interface
                  features from the Protocol Editor component of the Fytotron Client by Photon Systems Instruments (PSI).
                  It is provided solely for academic, educational, and research purposes.
                </p>

                <div className="bg-white p-4 rounded border border-red-300">
                  <p className="font-semibold text-red-900 mb-2">This software is NOT:</p>
                  <ul className="space-y-1 ml-4">
                    <li>Affiliated with, endorsed by, or produced by PSI</li>
                    <li>Capable of connecting to, controlling, or operating any real instruments</li>
                    <li>Authorized for production, clinical, agricultural, or commercial settings</li>
                  </ul>
                </div>

                <p>All trademarks, product names, and intellectual property rights remain the sole property of their respective owners.</p>

                <p>
                  Any resemblance to the original software is for educational purposes only.
                  This imitation must not be used in any production, clinical, agricultural, or commercial setting.
                </p>

                <div className="bg-yellow-50 p-4 rounded border border-yellow-300 mt-4">
                  <p className="font-semibold text-yellow-900">
                    For a brief tutorial and proper usage guidelines, please refer to the ReadMe or the User Guide tab.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800 mb-3">Use Responsibly</h3>
              <p className="text-gray-700">
                By using Faketron, you acknowledge that you understand and accept these terms. This tool is meant
                to assist researchers and educators in protocol planning and visualization.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="text-center mt-8 text-gray-500 text-sm">
        <p>2025 NPEC - Netherlands Plant Eco-phenotyping Centre</p>
        <p className="mt-1">For educational and research purposes only</p>
      </div>
    </div>
  );
}
