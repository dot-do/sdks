# frozen_string_literal: true

require 'spec_helper'

RSpec.describe {{Name}}Do::Client do
  describe '#initialize' do
    it 'creates a client with default options' do
      client = described_class.new
      expect(client.base_url).to eq('https://{{name}}.do')
      expect(client.api_key).to be_nil
    end

    it 'creates a client with an API key' do
      client = described_class.new(api_key: 'test-key')
      expect(client.api_key).to eq('test-key')
    end

    it 'creates a client with a custom base URL' do
      client = described_class.new(base_url: 'https://custom.{{name}}.do')
      expect(client.base_url).to eq('https://custom.{{name}}.do')
    end
  end
end
