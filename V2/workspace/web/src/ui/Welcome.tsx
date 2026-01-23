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
      <span style={{
        color: activeTab === tabKey ? "#16a34a" : "#000000",
        fontWeight: activeTab === tabKey ? 700 : 600,
        fontSize: "0.9rem",
      }}>
        {label}
      </span>
    </LeafButton>
  );

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-center gap-8 mb-8">
        <img src={npecLogo} alt="NPEC logo" className="h-40 w-auto" />
        <div className="text-left">
          <h1 className="text-5xl font-bold text-gray-800 mb-3">
            Welcome to <span className="text-green-600">Faketotron</span>
          </h1>
          <p className="text-xl text-gray-600">
            A mock Fytotron Client protocol editor and viewer for Wageningen walk-in chambers G4-G8
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex justify-center border-b border-gray-200 mb-8">
        <TabButton tabKey="about" label="About & Credits" />
        <TabButton tabKey="tutorial" label="User Guide" />
        <TabButton tabKey="tabs" label="Tab Overview" />
        <TabButton tabKey="disclaimer" label="Disclaimer" />
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow-lg p-8">
        {/* About & Credits Tab */}
        {activeTab === "about" && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-6 rounded-lg border border-indigo-100">
              <h2 className="text-3xl font-bold text-gray-800 mb-4">Credits & Version</h2>
              <div className="space-y-2 text-gray-700">
                <p className="text-lg">
                  <strong>Made by:</strong> Danna Shao and Maarten Bots
                </p>
                <p className="text-lg">
                  <strong>Version:</strong> V3 (23-02-2026)
                </p>
                <p className="text-lg">
                  <strong>Developed by:</strong> Maarten Bots
                </p>
              </div>
            </div>

            <div className="bg-blue-50 p-6 rounded-lg border border-blue-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Example Protocols Available</h3>
              <p className="text-gray-700 mb-2">
                Download from the <strong>Google Drive</strong> above: <strong>G4, G5, G6, G7, G8</strong> (including crazy experimental variants)
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
                      🚀 Open Google Drive Resources
                    </a>
                    <div className="mt-4 bg-green-50 p-4 rounded border border-green-200">
                      <p className="font-semibold text-green-900 mb-2">What's included in the Drive:</p>
                      <ul className="space-y-1 text-gray-700 ml-4">
                        <li>✓ <strong>Example .fyt protocol files</strong> (G4, G5, G6, G7, G8)</li>
                        <li>✓ <strong>CSV template files</strong> for importing time-series data</li>
                        <li>✓ <strong>PDF tutorial</strong> with step-by-step instructions</li>
                        <li>✓ <strong>Sample experimental protocols</strong></li>
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
                  <li>• <strong>GitHub Repository:</strong> <a href="https://github.com/NPEC-NL/Faketotron" className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">https://github.com/NPEC-NL/Faketotron</a></li>
                  <li>• <strong>Online Access:</strong> <a href="https://www.npec.nl/faketron.html" className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">https://www.npec.nl/faketron.html</a></li>
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

        {/* Tutorial Tab */}
        {activeTab === "tutorial" && (
          <div className="space-y-6 text-gray-700">
            <section>
              <h2 className="text-3xl font-bold text-gray-800 mb-4">Faketotron User Guide</h2>
              <p className="text-lg mb-4">
                A mock Fytotron Client protocol editor and viewer (.Html, runs in the browser). 
                Faketotron helps you build complex Wageningen walk-in chambers G4-G8 protocols.
              </p>
            </section>

            <section className="bg-indigo-50 p-6 rounded-lg border border-indigo-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Why use Faketotron instead of PSI Fytotron?</h3>
              <ul className="space-y-2 ml-4">
                <li>✓ All the same original features from PSI Fytotron, with some added features</li>
                <li>✓ <strong>Internet accessible:</strong> Access via <a href="https://www.npec.nl/faketron.html" className="text-indigo-600 hover:underline">https://www.npec.nl/faketron.html</a></li>
                <li>✓ <strong>Enhanced visualizations:</strong> More graphs and fine-tuning options</li>
                <li>✓ <strong>Copy-paste efficiency:</strong> Generate a 24-hour protocol and copy-paste it 45 times for multi-day experiments</li>
                <li>✓ <strong>CSV import:</strong> Import time-series data with second resolution and paste over phases</li>
                <li>✓ <strong>Optimized storage:</strong> Only stores seconds when there's a change (unlike Fytotron's 100,000s of rows)</li>
                <li>✓ <strong>Export & reload:</strong> Export machine-readable .fyt files and load them back for review or modification</li>
              </ul>
            </section>

            <section className="bg-yellow-50 p-6 rounded-lg border border-yellow-200">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">⚠️ Limits & Best Practices</h3>
              <ul className="space-y-2 ml-4">
                <li><strong>Maximum duration:</strong> 45 days is recommended</li>
                <li><strong>Time format:</strong> D.HH:MM:SS (Days.Hours:Minutes:Seconds)
                  <ul className="ml-6 mt-1 text-sm">
                    <li>• 01:30:00 = 1 hour 30 minutes</li>
                    <li>• 1.00:00:00 = exactly 24 hours</li>
                    <li>• 1.06:00:00 = 30 hours</li>
                  </ul>
                </li>
                <li><strong>Group duration:</strong> Total duration of each group must be the same</li>
                <li><strong>Constant parameters:</strong> If a parameter doesn't need changes, add a single constant phase for full duration (e.g., UV light at 0)</li>
                <li><strong>Humidity minimum:</strong> 50 is the minimum you can set</li>
                <li><strong>CO₂:</strong> No CO₂ scrubbing available</li>
                <li><strong>Edit Groups:</strong> Don't use unless you're using non-standard Groups</li>
              </ul>
            </section>

            <section>
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Key Concepts</h3>
              
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="font-bold text-gray-800 mb-2">Variables (what you control)</h4>
                  <p className="text-sm">Examples: Temperature, CO₂, Cool White, Deep Red, Far Red, Humidity, UVB</p>
                </div>
                
                <div className="bg-purple-50 p-4 rounded-lg">
                  <h4 className="font-bold text-gray-800 mb-2">Phases (how values change over time)</h4>
                  <p className="text-sm">Protocols are built from phases that run in order</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="border-l-4 border-green-500 pl-4 py-2 bg-green-50">
                  <strong>Constant:</strong> Hold one value for a duration<br/>
                  <span className="text-sm text-gray-600">Example: 21 °C for 16 hours</span>
                </div>
                <div className="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50">
                  <strong>Ramp:</strong> Move linearly from start to end<br/>
                  <span className="text-sm text-gray-600">Example: 16 → 21 °C in 30 minutes</span>
                </div>
                <div className="border-l-4 border-purple-500 pl-4 py-2 bg-purple-50">
                  <strong>Sine:</strong> Smooth oscillation between min/max with a period<br/>
                  <span className="text-sm text-gray-600">Example: Circadian-like changes</span>
                </div>
                <div className="border-l-4 border-yellow-500 pl-4 py-2 bg-yellow-50">
                  <strong>Cloud:</strong> Pseudo-random "cloud cover" behavior<br/>
                  <span className="text-sm text-gray-600">Useful for realistic flicker patterns</span>
                </div>
              </div>
            </section>

            <div className="bg-gradient-to-r from-yellow-50 to-amber-50 p-6 rounded-lg border-2 border-yellow-300 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-2xl font-bold text-gray-800">Need Help? Download the PDF Tutorial!</h3>
              </div>
              <p className="text-gray-700 mb-3">
                A complete step-by-step PDF tutorial is available in the <strong>Google Drive</strong> (link above). 
                Perfect for first-time users!
              </p>
            </div>

            <section className="bg-green-50 p-6 rounded-lg border border-green-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Quick Start (Recommended Workflow)</h3>
              
              <div className="bg-white p-4 rounded-lg border border-green-200 mb-4">
                <p className="font-bold text-green-800 mb-2">First Time? Download Example Files:</p>
                <p className="text-gray-700">
                  Visit the <a href="https://drive.google.com/drive/u/1/folders/1gZKerfe52QwXIYPSa2mCQGP49loRlIfO" className="text-green-600 hover:underline font-semibold" target="_blank" rel="noopener noreferrer">Google Drive</a> to download example .fyt protocols and the PDF tutorial before starting!
                </p>
              </div>
              
              <h4 className="font-bold text-gray-800 mt-4 mb-2">Loading or Creating a Protocol:</h4>
              <ul className="space-y-1 ml-4">
                <li>• <strong>Load protocol:</strong> Choose "Load" and select a .fyt file (download examples from Drive first!)</li>
                <li>• <strong>New protocol:</strong> Choose "New" in the protocol panel</li>
              </ul>

              <h4 className="font-bold text-gray-800 mt-4 mb-2">Building the Protocol (Step-by-step):</h4>
              <ol className="space-y-1 ml-6 list-decimal">
                <li>Pick a Group (e.g., Temperature Group 1)</li>
                <li>Click Add Phase</li>
                <li>Choose the phase type (Constant / Ramp / Sine / Cloud)</li>
                <li>Enter value(s) and duration</li>
                <li>Repeat until the full schedule is defined</li>
                <li>Drag rows if you need to reorder phases</li>
                <li><strong>Tip:</strong> Make some groups 24 hours, and copy-paste them 45 times</li>
                <li>Make sure ALL Groups have the same total duration (e.g., constant groups like UVB at 0 should be 45 days long)</li>
              </ol>

              <h4 className="font-bold text-gray-800 mt-4 mb-2">Save / Export:</h4>
              <ul className="space-y-1 ml-4">
                <li>• Before saving, add a clear description: experiment name, chamber, start date, and protocol controls</li>
                <li>• <strong>.fyt file:</strong> Machine-readable protocol file for PSI systems</li>
              </ul>
            </section>
          </div>
        )}

        {/* Tabs Overview */}
        {activeTab === "tabs" && (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-6">Application Tabs Overview</h2>
            
            <div className="grid gap-6">
              <div className="bg-indigo-50 p-6 rounded-lg border-l-4 border-indigo-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">Editor Tab</h3>
                <p className="text-gray-700">
                  The main protocol editor interface. Here you can create, edit, and manage your protocol phases. 
                  Add groups, define phases (constant, ramp, sine, cloud), set durations, and arrange the sequence 
                  of your experiment. This is where you'll spend most of your time building protocols.
                </p>
              </div>

              <div className="bg-purple-50 p-6 rounded-lg border-l-4 border-purple-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">Graph Tab</h3>
                <p className="text-gray-700">
                  Visualize your protocol over time. See all your variables (temperature, light, humidity, etc.) 
                  plotted on interactive graphs. This helps you spot inconsistencies, verify ramps and transitions, 
                  and get a complete overview of your experiment timeline. Perfect for presentations and validation.
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
                <h3 className="text-xl font-bold text-gray-800 mb-2">FYT Inspector Tab (Hidden)</h3>
                <p className="text-gray-700 italic">
                  This tab is intentionally hidden but kept for future debugging purposes. It allows inspection 
                  of the raw .fyt file structure and binary data for advanced troubleshooting.
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border border-indigo-200 mt-6">
              <h3 className="text-xl font-bold text-gray-800 mb-3">Pro Tips</h3>
              <ul className="space-y-2 text-gray-700">
                <li>• Start with the <strong>Editor</strong> to build your protocol structure</li>
                <li>• Switch to the <strong>Graph</strong> frequently to validate your design</li>
                <li>• Use <strong>Light Tools</strong> for precise spectral control</li>
                <li>• Import real-world data via <strong>CSV</strong> for authentic conditions</li>
                <li>• Always check all tabs before exporting your final .fyt file</li>
              </ul>
            </div>
          </div>
        )}

        {/* Disclaimer Tab */}
        {activeTab === "disclaimer" && (
          <div className="space-y-6">
            <div className="bg-red-50 p-8 rounded-lg border-2 border-red-200">
              <h2 className="text-3xl font-bold text-red-800 mb-4">⚠️ Important Disclaimer</h2>
              
              <div className="space-y-4 text-gray-800 leading-relaxed">
                <p>
                  This software is an <strong>independent, non-commercial imitation</strong> of certain user interface 
                  features from the Protocol Editor component of the Fytotron Client by Photon Systems Instruments (PSI). 
                  It is provided solely for <strong>academic, educational, and research purposes</strong>.
                </p>

                <div className="bg-white p-4 rounded border border-red-300">
                  <p className="font-semibold text-red-900 mb-2">This software is NOT:</p>
                  <ul className="space-y-1 ml-4">
                    <li>• Affiliated with, endorsed by, or produced by PSI</li>
                    <li>• Capable of connecting to, controlling, or operating any real instruments</li>
                    <li>• Authorized for production, clinical, agricultural, or commercial settings</li>
                  </ul>
                </div>

                <p>
                  <strong>All trademarks, product names, and intellectual property rights remain the sole property 
                  of their respective owners.</strong>
                </p>

                <p>
                  Any resemblance to the original software is for <strong>educational purposes only</strong>. 
                  This imitation <strong>must not be used in any production, clinical, agricultural, or commercial setting</strong>.
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
                By using Faketotron, you acknowledge that you understand and accept these terms. This tool is meant 
                to assist researchers and educators in protocol planning and visualization, but should never replace 
                official PSI software for actual instrument control.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center mt-8 text-gray-500 text-sm">
        <p>© 2025 NPEC - Netherlands Plant Eco-phenotyping Centre</p>
        <p className="mt-1">For educational and research purposes only</p>
      </div>
    </div>
  );
}
