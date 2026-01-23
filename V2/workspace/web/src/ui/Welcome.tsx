import React, { useState } from "react";

type WelcomeTabKey = "about" | "tutorial" | "tabs" | "disclaimer";

export default function Welcome() {
  const [activeTab, setActiveTab] = useState<WelcomeTabKey>("about");

  const TabButton = ({ tabKey, label }: { tabKey: WelcomeTabKey; label: string }) => (
    <button
      onClick={() => setActiveTab(tabKey)}
      className={`px-6 py-3 font-semibold text-sm transition-all duration-200 border-b-2 ${
        activeTab === tabKey
          ? "border-indigo-600 text-indigo-600"
          : "border-transparent text-gray-600 hover:text-indigo-500 hover:border-gray-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold text-gray-800 mb-3">
          Welcome to <span className="text-indigo-600">Faketotron</span>
        </h1>
        <p className="text-xl text-gray-600">
          A mock Fytotron Client protocol editor and viewer for Wageningen walk-in chambers G4-G8
        </p>
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
                  <strong>Version:</strong> V1 (21-11-2025)
                </p>
                <p className="text-lg">
                  <strong>Developed by:</strong> Maarten Bots
                </p>
                <p className="text-lg">
                  <strong>With instructions from:</strong> Sofia Bengoa Luoni, Alan Pauls, and Rick van de Zedde
                </p>
              </div>
            </div>

            <div className="bg-blue-50 p-6 rounded-lg border border-blue-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Example Protocols</h3>
              <p className="text-gray-700 mb-2">
                Included example protocols: <strong>G4, G5, G6, G7, G8</strong> (including crazy experimental variants)
              </p>
              <p className="text-gray-600 italic">
                Feel free to load these examples to explore the features and build your own protocols.
              </p>
            </div>

            <div className="bg-green-50 p-6 rounded-lg border border-green-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Quick Access</h3>
              <ul className="space-y-2 text-gray-700">
                <li>• <strong>Instructions:</strong> See the User Guide tab or ReadMe</li>
                <li>• <strong>Online Access:</strong> <a href="https://www.npec.nl/faketron.html" className="text-indigo-600 hover:underline">https://www.npec.nl/faketron.html</a></li>
                <li>• <strong>Intended for:</strong> NPEC operators and users</li>
              </ul>
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

            <section className="bg-green-50 p-6 rounded-lg border border-green-100">
              <h3 className="text-2xl font-semibold text-gray-800 mb-3">Quick Start (Recommended Workflow)</h3>
              
              <h4 className="font-bold text-gray-800 mt-4 mb-2">Loading or Creating a Protocol:</h4>
              <ul className="space-y-1 ml-4">
                <li>• <strong>Load protocol:</strong> Choose "Load" and select a .fyt file to tweak an existing standard protocol</li>
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
                <h3 className="text-xl font-bold text-gray-800 mb-2">📝 Editor Tab</h3>
                <p className="text-gray-700">
                  The main protocol editor interface. Here you can create, edit, and manage your protocol phases. 
                  Add groups, define phases (constant, ramp, sine, cloud), set durations, and arrange the sequence 
                  of your experiment. This is where you'll spend most of your time building protocols.
                </p>
              </div>

              <div className="bg-purple-50 p-6 rounded-lg border-l-4 border-purple-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">📊 Graph Tab</h3>
                <p className="text-gray-700">
                  Visualize your protocol over time. See all your variables (temperature, light, humidity, etc.) 
                  plotted on interactive graphs. This helps you spot inconsistencies, verify ramps and transitions, 
                  and get a complete overview of your experiment timeline. Perfect for presentations and validation.
                </p>
              </div>

              <div className="bg-yellow-50 p-6 rounded-lg border-l-4 border-yellow-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">💡 Light Tools Tab</h3>
                <p className="text-gray-700">
                  Advanced light spectrum management. Fine-tune individual light channels (Cool White, Warm White, 
                  Deep Red, Far Red, UVB, etc.). Calculate PPFD values, manage light ratios, and ensure your 
                  lighting conditions match your experimental requirements precisely.
                </p>
              </div>

              <div className="bg-green-50 p-6 rounded-lg border-l-4 border-green-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">📄 CSV Tab</h3>
                <p className="text-gray-700">
                  Import time-series data from CSV files with second-level resolution. Paste imported data over 
                  existing phases to create complex, data-driven protocols. Useful for replicating real-world 
                  conditions from sensor data or implementing custom environmental patterns from external sources.
                </p>
              </div>

              <div className="bg-blue-50 p-6 rounded-lg border-l-4 border-blue-500">
                <h3 className="text-xl font-bold text-gray-800 mb-2">🔍 FYT Inspector Tab (Hidden)</h3>
                <p className="text-gray-700 italic">
                  This tab is intentionally hidden but kept for future debugging purposes. It allows inspection 
                  of the raw .fyt file structure and binary data for advanced troubleshooting.
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border border-indigo-200 mt-6">
              <h3 className="text-xl font-bold text-gray-800 mb-3">💡 Pro Tips</h3>
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
                    📚 For a brief tutorial and proper usage guidelines, please refer to the ReadMe or the User Guide tab.
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
