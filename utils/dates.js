const todayObj = new Date();
const yesterdayObj = new Date(todayObj);

yesterdayObj.setDate(yesterdayObj.getDate() - 1);

const formatDate = (date) => {
	let day = date.getDate() < 10 ? "0" + date.getDate() : date.getDate();
	let month =
		date.getMonth() + 1 < 10
			? "0" + (date.getMonth() + 1)
			: date.getMonth() + 1;
	let year = date.getFullYear();

	return year + "-" + month + "-" + day;
};

const today = formatDate(todayObj);
const yesterday = formatDate(yesterdayObj);

export { today, yesterday };
