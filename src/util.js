/**
 * gatherResponse awaits and returns a response body as a string.
 * Use await gatherResponse(..) in an async function to get the response body
 * @param {Response} response
 */
const gatherResponse = async response => {
  const { headers } = response;
  const contentType = headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await response.json();
  }
  return response.text();
};

const convertFormDataToObject = obj => {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const match = key.match(/(\w+)\[(\w+)\]/);
    if (match) {
      const [, parentKey, propertyKey] = match;
      result[parentKey] = result[parentKey] || {};
      result[parentKey][propertyKey] = value;
    } else {
      result[key] = value; // Handle other keys that don't follow the 'key[property]' pattern
    }
  }

  return result;
};

// `id` and `timestamp` (milliseconds) fill the {@id} and {@timestamp} placeholders
const handlePlaceholders = (inputValue, fields, options, { id, timestamp }) => {
  const replacedWithFields = inputValue.replace(/\{fields\.(\w+)\}/g, (match, key) => {
    return fields[key] || '';
  });
  const replacedValue = replacedWithFields.replace(/\{options\.(\w+)\}/g, (match, key) => {
    return options[key] || '';
  });

  return replacedValue.replace(/{@timestamp}/g, timestamp).replace(/{@id}/g, id);
};

// Evaluates staticman-style generatedFields; only the `date` type is supported
const buildGeneratedFields = (generatedFieldsConfig, now) => {
  const generated = {};

  for (const [key, config] of Object.entries(generatedFieldsConfig || {})) {
    if (config?.type !== 'date') continue;

    const format = config?.options?.format || 'iso8601';
    if (format === 'timestamp') {
      generated[key] = now.valueOf();
    } else if (format === 'timestamp-seconds') {
      generated[key] = Math.floor(now.valueOf() / 1000);
    } else {
      generated[key] = now.toISOString();
    }
  }

  return generated;
};

const objectToMarkdownTable = obj => {
  let markdown = '| Field | Content |\n';
  markdown += '| --- | --- |\n';

  for (const [key, value] of Object.entries(obj)) {
    // Handle multi-line strings
    const sanitizedValue = typeof value === 'string' ? value.replace(/\n/g, ' ') : value;
    markdown += `| ${key} | ${sanitizedValue} |\n`;
  }

  return markdown;
};

export {
  buildGeneratedFields,
  convertFormDataToObject,
  gatherResponse,
  handlePlaceholders,
  objectToMarkdownTable
};
