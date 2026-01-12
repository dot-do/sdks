# {{Name}}.do Crystal SDK
#
# {{description}}
#
# Example:
# ```crystal
# require "{{name}}_do"
#
# client = {{Name}}Do::Client.new(api_key: ENV["DOTDO_KEY"]?)
# client.connect
# ```

require "./{{name}}_do/client"
require "./{{name}}_do/error"
require "./{{name}}_do/version"

module {{Name}}Do
  # Module-level connect helper
  def self.connect(api_key : String? = nil, base_url : String = "https://{{name}}.do")
    client = Client.new(api_key: api_key, base_url: base_url)
    client.connect
    client
  end
end
