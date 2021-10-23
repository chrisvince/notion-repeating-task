const functions = require('firebase-functions')
const {Client} = require('@notionhq/client')
const {pipe} = require('ramda')
const moment = require('moment')

const NOTION_KEY = functions.config().notion.key
const DATABASE_ID = functions.config().notion.database_id

const notion = new Client({auth: NOTION_KEY})

const CREATED_AT_PROPERTY_NAME = 'Created At'
const DO_PROPERTY_NAME = 'Do'
const REPEATING_PROPERTY_NAME = 'Repeating'
const REPEAT_DATES_MONTHLY_PROPERTY_NAME = 'Repeat Dates (Monthly)'
const REPEAT_DAYS_WEEKLY_PROPERTY_NAME = 'Repeat Days (Weekly)'
const REPEAT_EVERY_PROPERTY_NAME = 'Repeat Every'
const REPEAT_FREQUENCY_PROPERTY_NAME = 'Repeat Frequency'
const REPEAT_TEMPLATE_PROPERTY_NAME = 'Is Repeat Template'

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

const dataRemovalProperties = DATA_REMOVAL_KEYS.reduce((acc, key) => ({
  ...acc,
  [key]: undefined,
}), {})

const createDailyTaskInstance = (item) => {
  const createdAt = (
    moment(item.properties[CREATED_AT_PROPERTY_NAME].created_time)
  )
  const daysFromCreated = createdAt.diff(moment(), 'days')
  const repeatEvery = item.properties[REPEAT_EVERY_PROPERTY_NAME].number || 1
  const shouldCreate = daysFromCreated % repeatEvery === 0
  if (!shouldCreate) return null
  return item
}

const createWeeklyTaskInstance = (item) => {
  const createdAt = (
    moment(item.properties[CREATED_AT_PROPERTY_NAME].created_time)
  )
  const weeksFromCreated = createdAt.diff(moment(), 'weeks')
  const repeatEvery = item.properties[REPEAT_EVERY_PROPERTY_NAME].number || 1
  const isMatchingWeek = weeksFromCreated % repeatEvery === 0
  if (!isMatchingWeek) return null
  const nowDay = moment().day()
  const defaultDays = [createdAt.day()]
  const repeatDaysProperty = item.properties[REPEAT_DAYS_WEEKLY_PROPERTY_NAME]
      .multi_select.map((x) => DAYS[x.name])
  const repeatDays = (
    repeatDaysProperty.length ? repeatDaysProperty : defaultDays
  )
  const shouldCreate = repeatDays.includes(nowDay)
  if (!shouldCreate) return null
  return item
}

const createMonthlyTaskInstance = (item) => {
  const createdAt = (
    moment(item.properties[CREATED_AT_PROPERTY_NAME].created_time)
  )
  const monthsFromCreated = createdAt.diff(moment(), 'months')
  const repeatEvery = item.properties[REPEAT_EVERY_PROPERTY_NAME].number || 1
  const isMatchingMonths = monthsFromCreated % repeatEvery === 0
  if (!isMatchingMonths) return null
  const nowDate = moment().date()
  const defaultDates = [createdAt.date()]
  const repeatDatesProperty = (
    item.properties[REPEAT_DATES_MONTHLY_PROPERTY_NAME]
        .multi_select.map((x) => parseInt(x.name, 10))
  )
  const repeatDates = (
      repeatDatesProperty.length ? repeatDatesProperty : defaultDates
  )
  const shouldCreate = repeatDates.includes(nowDate)
  if (!shouldCreate) return null
  return item
}

const createTaskInstance = (item, frequency) => ({
  Daily: createDailyTaskInstance,
  Weekly: createWeeklyTaskInstance,
  Monthly: createMonthlyTaskInstance,
}[frequency]?.(item))

const createTaskInstances = (items) => items?.reduce((acc, item) => {
  const repeatFrequency = (
    item.properties[REPEAT_FREQUENCY_PROPERTY_NAME]?.select?.name
  )
  functions.logger.log('repeatFrequency', repeatFrequency)
  if (!repeatFrequency) return acc
  const processedItem = createTaskInstance(item, repeatFrequency)
  if (!processedItem) return acc
  functions.logger.log('processedItem', processedItem)
  return [...acc, processedItem]
}, [])

const manipulateProperties = (items) => items?.map((item) => ({
  ...item,
  properties: {
    ...item.properties,
    ...dataRemovalProperties,
    [REPEATING_PROPERTY_NAME]: {checkbox: true},
    [DO_PROPERTY_NAME]: {date: {start: moment().format('YYYY-MM-DD')}},
  },
}))

const stripPropertyIdAndType = (items) => items?.map((item) => ({
  ...item,
  properties: {
    ...item.properties,
    id: undefined,
    type: undefined,
  },
}))

const processData = pipe(
    createTaskInstances,
    (x) => {
      functions.logger.log('Post processRepeat', x)
      return x
    },
    manipulateProperties,
    (x) => {
      functions.logger.log('Post manipulateProperties', x)
      return x
    },
    stripPropertyIdAndType,
    (x) => {
      functions.logger.log('Post stripPropertyIdAndType', x)
      return x
    },
)

const addItem = async (properties) => {
  try {
    await notion.pages.create({
      parent: {database_id: DATABASE_ID},
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
          checkbox: {equals: true},
        }],
      },
    })
    return response.results || []
  } catch (error) {
    console.error(error.body)
  }
}

exports.createNotionRepeatedTasks =
  functions.pubsub.schedule('0 2 * * *')
      .timeZone('America/New_York').onRun(async () => {
        const data = await queryDatabase()
        functions.logger.log('Post queryDatabase', data)
        const items = processData(data)
        const createPromises = items.map((item) => addItem(item.properties))
        await Promise.all(createPromises)
        return null
      })
