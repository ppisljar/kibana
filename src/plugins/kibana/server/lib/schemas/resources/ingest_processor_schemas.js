import Joi from 'joi';

const base = Joi.object({
  processor_id: Joi.string().required()
});

export const append = base.keys({
  type_id: Joi.string().only('append').required(),
  target_field: Joi.string().allow(''),
  values: Joi.array().items(Joi.string().allow(''))
});

export const convert = base.keys({
  type_id: Joi.string().only('convert').required(),
  source_field: Joi.string().allow(''),
  target_field: Joi.string().allow(''),
  type: Joi.string()
});

export const date = base.keys({
  type_id: Joi.string().only('date').required(),
  source_field: Joi.string().allow(''),
  target_field: Joi.string().allow(''),
  formats: Joi.array().items(Joi.string().allow('')),
  timezone: Joi.string().allow(''),
  locale: Joi.string().allow(''),
  custom_format: Joi.string().allow('')
});

export const geoip = base.keys({
  type_id: Joi.string().only('geoip').required(),
  source_field: Joi.string().allow(''),
  target_field: Joi.string().allow(''),
  database_file: Joi.string().allow(''),
  database_fields: Joi.array().items(Joi.string().allow('')),
});

export const grok = base.keys({
  type_id: Joi.string().only('grok').required(),
  source_field: Joi.string().allow(''),
  pattern: Joi.string().allow('')
});

export const gsub = base.keys({
  type_id: Joi.string().only('gsub').required(),
  source_field: Joi.string().allow(''),
  pattern: Joi.string().allow(''),
  replacement: Joi.string().allow('')
});

export const set = base.keys({
  type_id: Joi.string().only('set').required(),
  target_field: Joi.string().allow(''),
  value: Joi.string().allow('')
});
