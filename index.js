const { Client } = require('@notionhq/client')
const { pipe } = require('ramda')
const moment = require('moment')

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const notion = new Client({ auth: process.env.NOTION_KEY })
const DATABASE_ID = process.env.NOTION_DATABASE_ID
const REPEAT_TEMPLATE_PROPERTY_NAME = 'Is Repeat Template'
const REPEAT_EVERY_PROPERTY_NAME = 'Repeat Every'
const REPEAT_DAYS_WEEKLY_PROPERTY_NAME = 'Repeat Days (Weekly)'
const REPEAT_DAYS_MONTHLY_PROPERTY_NAME = 'Repeat Days (Monthly)'
const CREATED_AT_PROPERTY_NAME = 'Created At'

const DATA_REMOVAL_KEYS = [
  CREATED_AT_PROPERTY_NAME,
  'Created',
  REPEAT_TEMPLATE_PROPERTY_NAME,
  'Status',
]

const DAYS = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
}

const dataRemovalProperties = DATA_REMOVAL_KEYS.reduce((acc, key) => ({ ...acc, [key]: undefined }), {})

const processDaily = item => {
  const createdAt = moment(item.properties[CREATED_AT_PROPERTY_NAME].created_time)
  const daysFromCreated = createdAt.diff(moment(), 'days')
  const repeatEvery = item.properties[REPEAT_EVERY_PROPERTY_NAME].number || 1
  const shouldCreate = daysFromCreated % repeatEvery === 0
  if (!shouldCreate) return null
  return item
}

const processWeekly = item => {
  const createdAt = moment(item.properties[CREATED_AT_PROPERTY_NAME].created_time)
  const weeksFromCreated = createdAt.diff(moment(), 'weeks')
  const repeatEvery = item.properties[REPEAT_EVERY_PROPERTY_NAME].number || 1
  const isMatchingWeek = weeksFromCreated % repeatEvery === 0
  if (!isMatchingWeek) return null
  const nowDay = moment().day()
  const defaultDays = [createdAt.day()]
  const repeatDaysProperty = item.properties[REPEAT_DAYS_WEEKLY_PROPERTY_NAME].multi_select.map(x => DAYS[x.name])
  const repeatDays = repeatDaysProperty.length ? repeatDaysProperty : defaultDays
  const shouldCreate = repeatDays.includes(nowDay)
  if (!shouldCreate) return null
  return item
}

const processMonthly = item => {
  const createdAt = moment(item.properties[CREATED_AT_PROPERTY_NAME].created_time)
  const monthsFromCreated = createdAt.diff(moment(), 'months')
  const repeatEvery = item.properties[REPEAT_EVERY_PROPERTY_NAME].number || 1
  const isMatchingMonths = monthsFromCreated % repeatEvery === 0
  if (!isMatchingMonths) return null
  const nowDate = moment().date()
  const defaultDates = [createdAt.date()]
  const repeatDatesProperty = item.properties[REPEAT_DAYS_MONTHLY_PROPERTY_NAME].multi_select.map(x => parseInt(x.name, 10))
  const repeatDates = repeatDatesProperty.length ? repeatDatesProperty : defaultDates
  const shouldCreate = repeatDates.includes(nowDate)
  if (!shouldCreate) return null
  return item
}

const processRepeatFrequency = (item, frequency) => ({
  Daily: processDaily,
  Weekly: processWeekly,
  Monthly: processMonthly,
}[frequency]?.(item))

const processRepeat = items => items.map(item => {
  const repeatFrequency = item.properties['Repeat Frequency'].select.name
  const processedItem = processRepeatFrequency(item, repeatFrequency)
  return processedItem
})

const manipulateProperties = items => items?.map(item => ({
  ...item,
  properties: {
    ...item.properties,
    ...dataRemovalProperties,
    Repeating: { checkbox: true },
  },
}))

const stripPropertyIdAndType = items => items?.map(item => ({
  ...item,
  properties: {
    ...item.properties,
    id: undefined,
    type: undefined,
  },
}))

const processData = pipe(
  processRepeat,
  manipulateProperties,
  stripPropertyIdAndType,
)

const addItem = async properties => {
  try {
    await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties,
    })
    console.log('Entry added.')
  } catch (error) {
    console.error(error.body)
  }
}

const queryDatabase = async () => {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        or: [{
          property: REPEAT_TEMPLATE_PROPERTY_NAME,
          checkbox: { equals: true },
        }],
      },
    })
    return response.results
  } catch (error) {
    console.error(error.body)
  }
}

const handler = () => {
  const data = queryDatabase()
  const items = processData(data)
  items.forEach(item => addItem(item.properties))
}

exports.handler = handler
